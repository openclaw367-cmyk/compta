import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function makePrismaMock() {
  return {
    account: { findFirst: jest.fn() },
    bankAccount: {
      findUnique: jest.fn(),
      create: jest.fn((args: { data: unknown }) => ({
        id: 'bank-account-1',
        ...(args.data as object),
      })),
      findMany: jest.fn(),
    },
  };
}

describe('BankAccountsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: BankAccountsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new BankAccountsService(prisma as unknown as PrismaService);
  });

  it('creates a bank account for a 512-prefix account', async () => {
    prisma.account.findFirst.mockResolvedValueOnce({
      id: 'acc-512',
      number: '512000',
      pcgClass: 5,
    });
    prisma.bankAccount.findUnique.mockResolvedValueOnce(null);
    const result = await service.create(company, { compteId: 'acc-512', label: 'BNP' });
    expect(result.label).toBe('BNP');
    expect(result.currency).toBe('EUR');
  });

  it('rejects a compteId that does not belong to this company', async () => {
    prisma.account.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(company, { compteId: 'acc-x', label: 'BNP' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a non-512/514/516/517 account (e.g. a charges account)', async () => {
    prisma.account.findFirst.mockResolvedValueOnce({
      id: 'acc-606',
      number: '606100',
      pcgClass: 6,
    });
    await expect(service.create(company, { compteId: 'acc-606', label: 'BNP' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a second BankAccount for the same PCG account (one-to-one)', async () => {
    prisma.account.findFirst.mockResolvedValueOnce({
      id: 'acc-512',
      number: '512000',
      pcgClass: 5,
    });
    prisma.bankAccount.findUnique.mockResolvedValueOnce({ id: 'existing', label: 'Déjà rattaché' });
    await expect(
      service.create(company, { compteId: 'acc-512', label: 'Doublon' }),
    ).rejects.toThrow(ConflictException);
  });

  it('accepts 514/516/517 too, not just 512', async () => {
    for (const number of ['514000', '516000', '517000']) {
      prisma.account.findFirst.mockResolvedValueOnce({ id: 'acc', number, pcgClass: 5 });
      prisma.bankAccount.findUnique.mockResolvedValueOnce(null);
      await expect(service.create(company, { compteId: 'acc', label: 'x' })).resolves.toBeDefined();
    }
  });
});
