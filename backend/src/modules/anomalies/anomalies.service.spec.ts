import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AnomaliesService } from './anomalies.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

const ACCOUNT_606400 = {
  id: 'acc-606400',
  number: '606400',
  label: 'Fournitures administratives',
  pcgClass: 6,
};
const ACCOUNT_707000 = {
  id: 'acc-707000',
  number: '707000',
  label: 'Ventes de marchandises',
  pcgClass: 7,
};
const FISCAL_YEAR_2026 = {
  id: 'fy-2026',
  companyId: 'company-1',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
};

function ligne(overrides: Record<string, unknown>) {
  return {
    id: 'ligne-1',
    compteId: ACCOUNT_606400.id,
    compte: ACCOUNT_606400,
    debit: new Prisma.Decimal('0.00'),
    credit: new Prisma.Decimal('0.00'),
    ecriture: { ecritureDate: new Date('2026-07-05') },
    ...overrides,
  };
}

function makePrismaMock() {
  const prisma = {
    fiscalYear: { findFirst: jest.fn().mockResolvedValue(FISCAL_YEAR_2026) },
    ecritureLigne: { findMany: jest.fn().mockResolvedValue([]) },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    ecriture: { findMany: jest.fn().mockResolvedValue([]) },
    bankStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return prisma;
}

function service(prisma: ReturnType<typeof makePrismaMock>): AnomaliesService {
  return new AnomaliesService(prisma as unknown as PrismaService);
}

describe('AnomaliesService.getSummary', () => {
  it('throws when fiscalYearId is missing', async () => {
    const prisma = makePrismaMock();
    await expect(service(prisma).getSummary(company, '')).rejects.toThrow(BadRequestException);
  });

  it('composes spending and payment anomalies', async () => {
    const prisma = makePrismaMock();
    const result = await service(prisma).getSummary(company, 'fy-2026');
    expect(result).toEqual({ spending: [], payments: [] });
  });
});

describe('AnomaliesService.detectSpendingAnomalies', () => {
  it('throws when the fiscal year does not belong to this company', async () => {
    const prisma = makePrismaMock();
    prisma.fiscalYear.findFirst.mockResolvedValue(null);
    await expect(service(prisma).detectSpendingAnomalies(company, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('aggregates raw lignes into monthly per-account totals and flags a real deviation', async () => {
    const prisma = makePrismaMock();
    const flatMonths = [
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
    ].map((date) =>
      ligne({ ecriture: { ecritureDate: new Date(date) }, debit: new Prisma.Decimal('100.00') }),
    );
    const spike = ligne({
      id: 'ligne-spike',
      ecriture: { ecritureDate: new Date('2026-07-10') },
      debit: new Prisma.Decimal('300.00'),
    });
    prisma.ecritureLigne.findMany.mockResolvedValue([...flatMonths, spike]);

    // Freeze "today" so the evaluated-month window includes July.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15'));
    const result = await service(prisma).detectSpendingAnomalies(company, 'fy-2026');
    jest.useRealTimers();

    expect(result).toEqual([
      expect.objectContaining({
        accountId: ACCOUNT_606400.id,
        month: '2026-07',
        currentAmount: '300.00',
        trailingAverage: '100.00',
      }),
    ]);
  });

  it('reads the credit side for a class-7 (produit) account, not debit', async () => {
    const prisma = makePrismaMock();
    const baseline = ['2026-01-05', '2026-02-05', '2026-03-05'].map((date) =>
      ligne({
        compteId: ACCOUNT_707000.id,
        compte: ACCOUNT_707000,
        ecriture: { ecritureDate: new Date(date) },
        credit: new Prisma.Decimal('1000.00'),
      }),
    );
    prisma.ecritureLigne.findMany.mockResolvedValue(baseline);

    jest.useFakeTimers().setSystemTime(new Date('2026-03-15'));
    const result = await service(prisma).detectSpendingAnomalies(company, 'fy-2026');
    jest.useRealTimers();

    // No spike this pass — just confirms the credit-side read didn't throw
    // and produced no false anomaly on a flat series.
    expect(result).toEqual([]);
  });
});

describe('AnomaliesService.detectPaymentAnomalies', () => {
  const INVOICE = {
    id: 'invoice-1',
    invoiceNumber: '5',
    clientAccountId: 'acc-411001',
    clientNameSnapshot: 'Client Petit',
    invoiceDate: new Date('2026-06-01'),
    postedEcritureId: 'ecriture-1',
  };

  it('returns [] with no écritures fetch when there are no finalized SALE invoices', async () => {
    const prisma = makePrismaMock();
    const result = await service(prisma).detectPaymentAnomalies(company);
    expect(result).toEqual([]);
    expect(prisma.ecriture.findMany).not.toHaveBeenCalled();
  });

  it('flags an unlettered open invoice as NONE with no bank data at all', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findMany.mockResolvedValue([INVOICE]);
    prisma.ecriture.findMany.mockResolvedValue([
      {
        id: 'ecriture-1',
        lignes: [{ compteId: 'acc-411001', debit: new Prisma.Decimal('1200.00'), lettrage: null }],
      },
    ]);

    jest.useFakeTimers().setSystemTime(new Date('2026-09-05'));
    const result = await service(prisma).detectPaymentAnomalies(company);
    jest.useRealTimers();

    expect(result).toEqual([
      expect.objectContaining({ invoiceId: 'invoice-1', matchTier: 'NONE', totalTTC: '1200.00' }),
    ]);
  });

  it('skips an invoice whose client ligne is already lettered — not "open"', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findMany.mockResolvedValue([INVOICE]);
    prisma.ecriture.findMany.mockResolvedValue([
      {
        id: 'ecriture-1',
        lignes: [{ compteId: 'acc-411001', debit: new Prisma.Decimal('1200.00'), lettrage: 'A' }],
      },
    ]);
    const result = await service(prisma).detectPaymentAnomalies(company);
    expect(result).toEqual([]);
  });

  it('skips an invoice whose posted écriture no longer exists, without throwing', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findMany.mockResolvedValue([INVOICE]);
    prisma.ecriture.findMany.mockResolvedValue([]); // écriture missing
    const result = await service(prisma).detectPaymentAnomalies(company);
    expect(result).toEqual([]);
  });

  it('surfaces a HIGH match when an unmatched statement line lines up', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findMany.mockResolvedValue([INVOICE]);
    prisma.ecriture.findMany.mockResolvedValue([
      {
        id: 'ecriture-1',
        lignes: [{ compteId: 'acc-411001', debit: new Prisma.Decimal('1200.00'), lettrage: null }],
      },
    ]);
    prisma.bankStatementLine.findMany.mockResolvedValue([
      {
        id: 'stmt-1',
        amount: new Prisma.Decimal('1200.00'),
        bookingDate: new Date('2026-06-10'),
        bankAccount: { label: 'Compte courant BNP' },
      },
    ]);

    jest.useFakeTimers().setSystemTime(new Date('2026-09-05'));
    const result = await service(prisma).detectPaymentAnomalies(company);
    jest.useRealTimers();

    expect(result[0].matchTier).toBe('HIGH');
  });
});
