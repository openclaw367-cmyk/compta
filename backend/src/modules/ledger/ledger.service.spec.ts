import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };
const D = (value: string) => new Prisma.Decimal(value);

const account607 = { id: 'acc-607', number: '607000', label: 'Achats de marchandises' };
const account401 = { id: 'acc-401', number: '401000', label: 'Fournisseurs' };

function makePrismaMock() {
  return {
    fiscalYear: {
      findFirst: jest.fn().mockResolvedValue({ id: 'fy-1', label: '2026', closedAt: null }),
    },
    account: {
      findFirst: jest.fn().mockResolvedValue(account607),
    },
    ecritureLigne: {
      findMany: jest.fn(),
    },
  };
}

describe('LedgerService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: LedgerService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new LedgerService(prisma as unknown as PrismaService);
  });

  describe('trialBalance', () => {
    it('aggregates debit/credit per account and computes overall totals', async () => {
      prisma.ecritureLigne.findMany.mockResolvedValueOnce([
        { compteId: 'acc-607', compte: account607, debit: D('1000.00'), credit: D('0.00') },
        { compteId: 'acc-607', compte: account607, debit: D('750.00'), credit: D('0.00') },
        { compteId: 'acc-401', compte: account401, debit: D('0.00'), credit: D('1750.00') },
      ]);

      const result = await service.trialBalance(company, { fiscalYearId: 'fy-1' });

      expect(result.lines).toEqual([
        {
          accountId: 'acc-401',
          accountNumber: '401000',
          accountLabel: 'Fournisseurs',
          totalDebit: '0.00',
          totalCredit: '1750.00',
          balance: '-1750.00',
        },
        {
          accountId: 'acc-607',
          accountNumber: '607000',
          accountLabel: 'Achats de marchandises',
          totalDebit: '1750.00',
          totalCredit: '0.00',
          balance: '1750.00',
        },
      ]);
      expect(result.totals).toEqual({ debit: '1750.00', credit: '1750.00', balance: '0.00' });
    });

    it('omits accounts with no lines in scope', async () => {
      prisma.ecritureLigne.findMany.mockResolvedValueOnce([]);
      const result = await service.trialBalance(company, { fiscalYearId: 'fy-1' });
      expect(result.lines).toEqual([]);
      expect(result.totals).toEqual({ debit: '0.00', credit: '0.00', balance: '0.00' });
    });

    it('passes the period filter through to the ecritureDate query', async () => {
      prisma.ecritureLigne.findMany.mockResolvedValueOnce([]);
      await service.trialBalance(company, {
        fiscalYearId: 'fy-1',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
      });
      expect(prisma.ecritureLigne.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ecriture: expect.objectContaining({
              fiscalYearId: 'fy-1',
              ecritureDate: { gte: new Date('2026-01-01'), lte: new Date('2026-06-30') },
            }),
          }),
        }),
      );
    });

    it('rejects an unknown fiscal year', async () => {
      prisma.fiscalYear.findFirst.mockResolvedValueOnce(null);
      await expect(service.trialBalance(company, { fiscalYearId: 'nope' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('accountLedger', () => {
    it('lists lines in date order with a running debit-minus-credit balance', async () => {
      prisma.ecritureLigne.findMany.mockResolvedValueOnce([
        {
          debit: D('1000.00'),
          credit: D('0.00'),
          lettrage: null,
          ecriture: {
            id: 'ecr-1',
            ecritureNum: '1',
            ecritureDate: new Date('2026-02-05'),
            pieceRef: 'FA-0001',
            libelle: 'Achat',
            journal: { code: 'AC' },
          },
        },
        {
          debit: D('0.00'),
          credit: D('400.00'),
          lettrage: 'A1',
          ecriture: {
            id: 'ecr-2',
            ecritureNum: '2',
            ecritureDate: new Date('2026-02-20'),
            pieceRef: 'REG-0001',
            libelle: 'Règlement',
            journal: { code: 'BQ' },
          },
        },
      ]);

      const result = await service.accountLedger(company, 'acc-607', { fiscalYearId: 'fy-1' });

      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toEqual(
        expect.objectContaining({ debit: '1000.00', credit: '0.00', runningBalance: '1000.00' }),
      );
      expect(result.lines[1]).toEqual(
        expect.objectContaining({
          debit: '0.00',
          credit: '400.00',
          lettrage: 'A1',
          runningBalance: '600.00',
        }),
      );
      expect(result.totals).toEqual({ debit: '1000.00', credit: '400.00', balance: '600.00' });
    });

    it('rejects an unknown account', async () => {
      prisma.account.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.accountLedger(company, 'nope', { fiscalYearId: 'fy-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an unknown fiscal year', async () => {
      prisma.fiscalYear.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.accountLedger(company, 'acc-607', { fiscalYearId: 'nope' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
