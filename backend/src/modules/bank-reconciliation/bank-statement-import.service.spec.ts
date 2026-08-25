import { readFileSync } from 'fs';
import { join } from 'path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BankStatementImportService } from './bank-statement-import.service';
import { Camt053ParserService } from './camt053-parser.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };
const xml = readFileSync(join(__dirname, '__fixtures__', 'sample-camt053.xml'), 'utf-8');

function makePrismaMock() {
  const prisma = {
    bankAccount: { findFirst: jest.fn() },
    bankStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
    bankStatementImport: {
      create: jest.fn((args: { data: unknown }) => ({ id: 'import-1', ...(args.data as object) })),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

describe('BankStatementImportService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: BankStatementImportService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new BankStatementImportService(
      prisma as unknown as PrismaService,
      new Camt053ParserService(),
    );
  });

  describe('preview', () => {
    it('rejects a bank account that does not belong to this company', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce(null);
      await expect(service.preview(company, 'bank-x', xml)).rejects.toThrow(NotFoundException);
    });

    it('parses without persisting anything', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1', compteId: 'acc-512' });
      const result = await service.preview(company, 'bank-1', xml);
      expect(result.lines).toHaveLength(5);
      expect(prisma.bankStatementImport.create).not.toHaveBeenCalled();
    });

    it('flags a line as a duplicate when its bankReference already exists for this bank account', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1', compteId: 'acc-512' });
      prisma.bankStatementLine.findMany.mockResolvedValueOnce([{ bankReference: 'REF002' }]);
      const result = await service.preview(company, 'bank-1', xml);
      const flagged = result.lines.find((l) => l.bankReference === 'REF002');
      expect(flagged?.isDuplicate).toBe(true);
      expect(result.lines.filter((l) => l.isDuplicate)).toHaveLength(1);
    });
  });

  describe('confirmImport', () => {
    it('persists one BankStatementImport and all its lines in one transaction', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1', compteId: 'acc-512' });
      const bankStatementLineCreateMany = jest.fn();
      (prisma as any).bankStatementLine.createMany = bankStatementLineCreateMany;
      const result = await service.confirmImport(company, 'bank-1', 'releve-mars.xml', xml);
      expect(result.fileName).toBe('releve-mars.xml');
      expect(bankStatementLineCreateMany).toHaveBeenCalledTimes(1);
      const data = bankStatementLineCreateMany.mock.calls[0][0].data;
      expect(data).toHaveLength(5);
    });

    it('refuses (all-or-nothing) when any line duplicates an already-imported reference', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1', compteId: 'acc-512' });
      prisma.bankStatementLine.findMany.mockResolvedValueOnce([{ bankReference: 'REF001' }]);
      const bankStatementLineCreateMany = jest.fn();
      (prisma as any).bankStatementLine.createMany = bankStatementLineCreateMany;
      await expect(service.confirmImport(company, 'bank-1', 'releve.xml', xml)).rejects.toThrow(
        ConflictException,
      );
      expect(bankStatementLineCreateMany).not.toHaveBeenCalled();
    });
  });
});
