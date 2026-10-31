import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BudgetingService } from './budgeting.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

const FISCAL_YEAR_2026 = {
  id: 'fy-2026',
  companyId: 'company-1',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  closedAt: null,
};

const ACCOUNT_613200 = {
  id: 'acc-613200',
  companyId: 'company-1',
  number: '613200',
  label: 'Locations',
};
const ACCOUNT_707000 = {
  id: 'acc-707000',
  companyId: 'company-1',
  number: '707000',
  label: 'Ventes',
};

const BUDGET_ROW = {
  id: 'budget-1',
  companyId: 'company-1',
  fiscalYearId: 'fy-2026',
  label: 'Budget 2026',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  lines: [
    {
      id: 'line-1',
      companyId: 'company-1',
      budgetId: 'budget-1',
      accountId: 'acc-613200',
      plannedAmount: new Prisma.Decimal('1000.00'),
      account: { number: '613200', label: 'Locations' },
    },
    {
      id: 'line-2',
      companyId: 'company-1',
      budgetId: 'budget-1',
      accountId: 'acc-707000',
      plannedAmount: new Prisma.Decimal('50000.00'),
      account: { number: '707000', label: 'Ventes' },
    },
  ],
};

function makePrismaMock() {
  const prisma = {
    fiscalYear: { findFirst: jest.fn().mockResolvedValue(FISCAL_YEAR_2026) },
    account: { findMany: jest.fn() },
    budget: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    budgetLine: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

function makeLedgerMock() {
  return { trialBalance: jest.fn() };
}

function service(
  prisma: ReturnType<typeof makePrismaMock>,
  ledger: ReturnType<typeof makeLedgerMock>,
): BudgetingService {
  return new BudgetingService(
    prisma as unknown as PrismaService,
    ledger as unknown as LedgerService,
  );
}

const validDto = {
  fiscalYearId: 'fy-2026',
  label: 'Budget 2026',
  lines: [
    { accountId: 'acc-613200', plannedAmount: '1000.00' },
    { accountId: 'acc-707000', plannedAmount: '50000.00' },
  ],
};

describe('BudgetingService.create', () => {
  it('creates a budget after validating the fiscal year and every line account', async () => {
    const prisma = makePrismaMock();
    prisma.account.findMany.mockResolvedValue([ACCOUNT_613200, ACCOUNT_707000]);
    prisma.budget.create.mockResolvedValue(BUDGET_ROW);

    const result = await service(prisma, makeLedgerMock()).create(company, validDto);

    expect(result.label).toBe('Budget 2026');
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].plannedAmount).toBe('1000.00');
    expect(prisma.budget.create).toHaveBeenCalled();
  });

  it('rejects an unknown fiscal year', async () => {
    const prisma = makePrismaMock();
    prisma.fiscalYear.findFirst.mockResolvedValue(null);
    await expect(service(prisma, makeLedgerMock()).create(company, validDto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a line naming an account that does not belong to this company', async () => {
    const prisma = makePrismaMock();
    prisma.account.findMany.mockResolvedValue([ACCOUNT_613200]); // 707000 missing
    await expect(service(prisma, makeLedgerMock()).create(company, validDto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a budget that lists the same account twice', async () => {
    const prisma = makePrismaMock();
    prisma.account.findMany.mockResolvedValue([ACCOUNT_613200]);
    await expect(
      service(prisma, makeLedgerMock()).create(company, {
        ...validDto,
        lines: [
          { accountId: 'acc-613200', plannedAmount: '1000.00' },
          { accountId: 'acc-613200', plannedAmount: '2000.00' },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('BudgetingService.findAll / findOne', () => {
  it('returns every budget with money-formatted lines', async () => {
    const prisma = makePrismaMock();
    prisma.budget.findMany.mockResolvedValue([BUDGET_ROW]);
    const [result] = await service(prisma, makeLedgerMock()).findAll(company);
    expect(result.id).toBe('budget-1');
    expect(result.lines[1].plannedAmount).toBe('50000.00');
  });

  it('throws when the budget does not belong to this company', async () => {
    const prisma = makePrismaMock();
    prisma.budget.findFirst.mockResolvedValue(null);
    await expect(service(prisma, makeLedgerMock()).findOne(company, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('BudgetingService.remove', () => {
  it('hard-deletes a budget — pure metadata, never part of the ledger', async () => {
    const prisma = makePrismaMock();
    prisma.budget.findFirst.mockResolvedValue(BUDGET_ROW);
    await service(prisma, makeLedgerMock()).remove(company, 'budget-1');
    expect(prisma.budget.delete).toHaveBeenCalledWith({ where: { id: 'budget-1' } });
  });

  it('throws when the budget does not belong to this company', async () => {
    const prisma = makePrismaMock();
    prisma.budget.findFirst.mockResolvedValue(null);
    await expect(service(prisma, makeLedgerMock()).remove(company, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('BudgetingService.compareToActual', () => {
  it("feeds LedgerService.trialBalance()'s own per-account actuals into computeBudgetVariance()", async () => {
    const prisma = makePrismaMock();
    prisma.budget.findFirst.mockResolvedValue(BUDGET_ROW);
    const ledger = makeLedgerMock();
    ledger.trialBalance.mockResolvedValue({
      fiscalYearId: 'fy-2026',
      lines: [
        {
          accountId: 'acc-613200',
          accountNumber: '613200',
          accountLabel: 'Locations',
          totalDebit: '1200.00',
          totalCredit: '0.00',
          balance: '1200.00',
        },
        {
          accountId: 'acc-707000',
          accountNumber: '707000',
          accountLabel: 'Ventes',
          totalDebit: '0.00',
          totalCredit: '45000.00',
          balance: '-45000.00',
        },
      ],
      totals: { debit: '1200.00', credit: '45000.00', balance: '-43800.00' },
    });

    const report = await service(prisma, ledger).compareToActual(company, 'budget-1');

    // Scoped to the budget's own fiscal year, the WHOLE year (no periodStart/periodEnd) —
    // not the controller's own current-fiscal-year selection.
    expect(ledger.trialBalance).toHaveBeenCalledWith(company, { fiscalYearId: 'fy-2026' });

    expect(report.budgetId).toBe('budget-1');
    expect(report.lines).toEqual([
      {
        accountId: 'acc-613200',
        accountNumber: '613200',
        accountLabel: 'Locations',
        plannedAmount: '1000.00',
        actualAmount: '1200.00',
        variance: '200.00',
        variancePercent: '20.00',
      },
      {
        accountId: 'acc-707000',
        accountNumber: '707000',
        accountLabel: 'Ventes',
        plannedAmount: '50000.00',
        actualAmount: '45000.00', // |-45000.00|
        variance: '-5000.00',
        variancePercent: '-10.00',
      },
    ]);
    expect(report.totals).toEqual({
      plannedAmount: '51000.00',
      actualAmount: '46200.00',
      variance: '-4800.00',
      variancePercent: '-9.41',
    });
  });

  it('reports "0.00" for a budgeted account with no matching actual in the trial balance at all', async () => {
    const prisma = makePrismaMock();
    prisma.budget.findFirst.mockResolvedValue({
      ...BUDGET_ROW,
      lines: [BUDGET_ROW.lines[0]], // only the 613200 line
    });
    const ledger = makeLedgerMock();
    ledger.trialBalance.mockResolvedValue({
      fiscalYearId: 'fy-2026',
      lines: [], // no ledger activity at all this year
      totals: { debit: '0.00', credit: '0.00', balance: '0.00' },
    });

    const report = await service(prisma, ledger).compareToActual(company, 'budget-1');

    expect(report.lines[0].actualAmount).toBe('0.00');
    expect(report.lines[0].variance).toBe('-1000.00');
  });

  it('throws when the budget does not belong to this company', async () => {
    const prisma = makePrismaMock();
    prisma.budget.findFirst.mockResolvedValue(null);
    await expect(
      service(prisma, makeLedgerMock()).compareToActual(company, 'nope'),
    ).rejects.toThrow(NotFoundException);
  });
});
