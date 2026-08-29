import { ConflictException, NotFoundException, NotImplementedException } from '@nestjs/common';
import { BankAggregatorLinkStatus, BankAggregatorProvider } from '@prisma/client';
import { BankAggregatorLinkService } from './bank-aggregator-link.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CredentialEncryptionService } from '../../common/crypto/credential-encryption.service';
import { BankStatementImportService } from '../bank-reconciliation/bank-statement-import.service';
import { CompanyContext } from '../../common/tenant/company-context';
import * as registry from './bank-aggregator-registry';

jest.mock('./bank-aggregator-registry');

const company: CompanyContext = { companyId: 'company-1' };

function makePrismaMock() {
  return {
    company: { findUnique: jest.fn() },
    bankAccount: { findFirst: jest.fn() },
    bankAggregatorLink: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function makeEncryptionMock() {
  return {
    encrypt: jest.fn((plain: string) => `enc:${plain}`),
    decrypt: jest.fn((cipher: string) => cipher.replace(/^enc:/, '')),
    mask: jest.fn((plain: string) => `masked:${plain}`),
  };
}

function makeStatementImportMock() {
  return {
    existingReferences: jest.fn().mockResolvedValue(new Set()),
    assertNoDuplicates: jest.fn(),
    persistParsedStatement: jest.fn().mockResolvedValue({ id: 'import-1' }),
  };
}

function makeDefaultPortMock() {
  return {
    createConnectSession: jest
      .fn()
      .mockResolvedValue({ connectUrl: 'https://connect.example/session' }),
    confirmLink: jest
      .fn()
      .mockResolvedValue({ externalItemId: 'item-1', accessToken: 'token-1', label: 'Ma Banque' }),
    fetchTransactions: jest.fn(),
    revoke: jest.fn(),
  };
}

describe('BankAggregatorLinkService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let encryption: ReturnType<typeof makeEncryptionMock>;
  let statementImport: ReturnType<typeof makeStatementImportMock>;
  let defaultPort: ReturnType<typeof makeDefaultPortMock>;
  let service: BankAggregatorLinkService;

  beforeEach(() => {
    prisma = makePrismaMock();
    encryption = makeEncryptionMock();
    statementImport = makeStatementImportMock();
    defaultPort = makeDefaultPortMock();
    (registry.createBankAggregatorAdapter as jest.Mock).mockReturnValue(defaultPort);
    service = new BankAggregatorLinkService(
      prisma as unknown as PrismaService,
      encryption as unknown as CredentialEncryptionService,
      {} as never, // ConfigService — never read directly by this service, only passed through
      statementImport as unknown as BankStatementImportService,
      defaultPort,
    );
  });

  describe('Monaco jurisdiction guard', () => {
    it('createConnectSession throws NotImplementedException for an MC company, before any port call', async () => {
      prisma.company.findUnique.mockResolvedValueOnce({ jurisdiction: 'MC' });
      await expect(service.createConnectSession(company, 'bank-1')).rejects.toThrow(
        NotImplementedException,
      );
      expect(defaultPort.createConnectSession).not.toHaveBeenCalled();
    });

    it('confirmLink throws NotImplementedException for an MC company, before any port call', async () => {
      prisma.company.findUnique.mockResolvedValueOnce({ jurisdiction: 'MC' });
      await expect(service.confirmLink(company, 'bank-1', {})).rejects.toThrow(
        NotImplementedException,
      );
      expect(defaultPort.confirmLink).not.toHaveBeenCalled();
    });

    it('proceeds normally for an FR company', async () => {
      prisma.company.findUnique.mockResolvedValueOnce({ jurisdiction: 'FR' });
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1' });
      const result = await service.createConnectSession(company, 'bank-1');
      expect(result.connectUrl).toBe('https://connect.example/session');
    });

    it('throws NotFoundException when the company itself does not exist', async () => {
      prisma.company.findUnique.mockResolvedValueOnce(null);
      await expect(service.createConnectSession(company, 'bank-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('confirmLink', () => {
    it('encrypts the access token and upserts a link, never storing plaintext', async () => {
      prisma.company.findUnique.mockResolvedValueOnce({ jurisdiction: 'FR' });
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1' });
      prisma.bankAggregatorLink.upsert.mockResolvedValueOnce({
        id: 'link-1',
        bankAccountId: 'bank-1',
        provider: BankAggregatorProvider.BRIDGE,
        maskedAccessToken: 'masked:Ma Banque',
        status: BankAggregatorLinkStatus.ACTIVE,
        lastSyncedAt: null,
      });

      await service.confirmLink(company, 'bank-1', { code: 'abc' });

      expect(encryption.encrypt).toHaveBeenCalledWith('token-1');
      const upsertArgs = prisma.bankAggregatorLink.upsert.mock.calls[0][0];
      expect(upsertArgs.create.encryptedAccessToken).toBe('enc:token-1');
      expect(upsertArgs.create.externalItemId).toBe('item-1');
      expect(upsertArgs.where).toEqual({ bankAccountId: 'bank-1' });
    });
  });

  describe('syncNow', () => {
    function activeLink(overrides: Record<string, unknown> = {}) {
      return {
        id: 'link-1',
        bankAccountId: 'bank-1',
        companyId: 'company-1',
        provider: BankAggregatorProvider.BRIDGE,
        externalItemId: 'item-1',
        encryptedAccessToken: 'enc:token-1',
        status: BankAggregatorLinkStatus.ACTIVE,
        lastSyncedAt: null,
        ...overrides,
      };
    }

    it('decrypts the token, fetches since lastSyncedAt, and calls persistParsedStatement()', async () => {
      const link = activeLink({ lastSyncedAt: new Date('2026-03-01T00:00:00.000Z') });
      prisma.bankAggregatorLink.findFirst.mockResolvedValueOnce(link);
      const parsed = {
        iban: null,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        openingBalance: '0.00',
        closingBalance: '10.00',
        lines: [
          {
            bookingDate: '2026-03-05',
            valueDate: null,
            amount: '10.00',
            label: 'x',
            bankReference: 'tx-1',
          },
        ],
      };
      defaultPort.fetchTransactions.mockResolvedValueOnce(parsed);

      const result = await service.syncNow(company, 'bank-1');

      expect(defaultPort.fetchTransactions).toHaveBeenCalledWith(
        'token-1',
        'item-1',
        link.lastSyncedAt,
      );
      expect(statementImport.assertNoDuplicates).toHaveBeenCalledWith(parsed, expect.any(Set));
      expect(statementImport.persistParsedStatement).toHaveBeenCalledWith(
        company,
        'bank-1',
        expect.stringContaining('Bridge'),
        parsed,
      );
      expect(prisma.bankAggregatorLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { lastSyncedAt: expect.any(Date) },
      });
      expect(result).toEqual({ importedLines: 1 });
    });

    it('rejects syncing a link that is not ACTIVE, naming the status', async () => {
      prisma.bankAggregatorLink.findFirst.mockResolvedValueOnce(
        activeLink({ status: BankAggregatorLinkStatus.ERROR }),
      );
      await expect(service.syncNow(company, 'bank-1')).rejects.toThrow(ConflictException);
      expect(defaultPort.fetchTransactions).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no link exists for this bank account', async () => {
      prisma.bankAggregatorLink.findFirst.mockResolvedValueOnce(null);
      await expect(service.syncNow(company, 'bank-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('revoke', () => {
    it('calls the port revoke() BEFORE deleting the local row', async () => {
      const link = {
        id: 'link-1',
        provider: BankAggregatorProvider.BRIDGE,
        externalItemId: 'item-1',
        encryptedAccessToken: 'enc:token-1',
      };
      prisma.bankAggregatorLink.findFirst.mockResolvedValueOnce(link);
      const callOrder: string[] = [];
      defaultPort.revoke.mockImplementationOnce(() => {
        callOrder.push('port.revoke');
        return Promise.resolve();
      });
      prisma.bankAggregatorLink.delete.mockImplementationOnce(() => {
        callOrder.push('prisma.delete');
        return Promise.resolve();
      });

      await service.revoke(company, 'bank-1');

      expect(defaultPort.revoke).toHaveBeenCalledWith('token-1', 'item-1');
      expect(callOrder).toEqual(['port.revoke', 'prisma.delete']);
    });

    it('marks the link ERROR (never deletes) when the provider revoke call fails', async () => {
      const link = {
        id: 'link-1',
        provider: BankAggregatorProvider.BRIDGE,
        externalItemId: 'item-1',
        encryptedAccessToken: 'enc:token-1',
      };
      prisma.bankAggregatorLink.findFirst.mockResolvedValueOnce(link);
      defaultPort.revoke.mockRejectedValueOnce(new Error('Bridge unreachable'));

      await expect(service.revoke(company, 'bank-1')).rejects.toThrow('Bridge unreachable');

      expect(prisma.bankAggregatorLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { status: BankAggregatorLinkStatus.ERROR },
      });
      expect(prisma.bankAggregatorLink.delete).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns masked summaries scoped to the company, never the encrypted token', async () => {
      prisma.bankAggregatorLink.findMany.mockResolvedValueOnce([
        {
          id: 'link-1',
          bankAccountId: 'bank-1',
          provider: BankAggregatorProvider.BRIDGE,
          maskedAccessToken: 'masked:Ma Banque',
          status: BankAggregatorLinkStatus.ACTIVE,
          lastSyncedAt: null,
        },
      ]);
      const result = await service.list(company);
      expect(result).toHaveLength(1);
      const findManyArgs = prisma.bankAggregatorLink.findMany.mock.calls[0][0];
      expect(findManyArgs.select.encryptedAccessToken).toBeUndefined();
      expect(findManyArgs.where).toEqual({ companyId: 'company-1' });
    });
  });
});
