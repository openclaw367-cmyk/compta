import {
  computeBudgetVariance,
  computeBudgetVarianceTotals,
  type ActualAccountBalance,
  type BudgetVarianceLineInput,
} from './budgeting';

/**
 * Hand-traced oracle for the budget-vs-actual variance arithmetic — zero
 * Prisma/DB, pure function in, pure data out. See budgeting.ts's own
 * doc comment for the two design decisions this locks in: "actual" is
 * the ABSOLUTE VALUE of the real ledger balance (debit − credit), and
 * variancePercent is null exactly when plannedAmount is "0.00".
 */
describe('computeBudgetVariance', () => {
  it('computes variance for a debit-normal (charge) account that overspent', () => {
    // Planned 1000.00 to spend on 613200 (location — a charge account);
    // real ledger balance (debit - credit) is +1200.00 (debit-heavy, as
    // expected for a charge account that got MORE activity than planned).
    const lines: BudgetVarianceLineInput[] = [
      {
        accountId: 'acc-613200',
        accountNumber: '613200',
        accountLabel: 'Locations',
        plannedAmount: '1000.00',
      },
    ];
    const actuals: ActualAccountBalance[] = [{ accountId: 'acc-613200', balance: '1200.00' }];

    const [result] = computeBudgetVariance(lines, actuals);

    expect(result).toEqual({
      accountId: 'acc-613200',
      accountNumber: '613200',
      accountLabel: 'Locations',
      plannedAmount: '1000.00',
      actualAmount: '1200.00',
      variance: '200.00', // actual - budget, overspent by 200.00
      variancePercent: '20.00', // 200.00 / 1000.00 * 100
    });
  });

  it('computes variance for a credit-normal (produit) account, using the magnitude of a negative ledger balance', () => {
    // Planned 50000.00 of revenue on 707000; the ledger's own debit -
    // credit balance for a credit-heavy revenue account is NEGATIVE
    // (-45000.00) — the pure function takes |balance|, so this compares
    // as 45000.00 actual against 50000.00 planned, a shortfall.
    const lines: BudgetVarianceLineInput[] = [
      {
        accountId: 'acc-707000',
        accountNumber: '707000',
        accountLabel: 'Ventes',
        plannedAmount: '50000.00',
      },
    ];
    const actuals: ActualAccountBalance[] = [{ accountId: 'acc-707000', balance: '-45000.00' }];

    const [result] = computeBudgetVariance(lines, actuals);

    expect(result.actualAmount).toBe('45000.00');
    expect(result.variance).toBe('-5000.00'); // under plan by 5000.00
    expect(result.variancePercent).toBe('-10.00');
  });

  it('reports "0.00" (never an omission) for a budgeted account with no matching actual at all', () => {
    const lines: BudgetVarianceLineInput[] = [
      {
        accountId: 'acc-618900',
        accountNumber: '618900',
        accountLabel: 'Divers',
        plannedAmount: '300.00',
      },
    ];
    const [result] = computeBudgetVariance(lines, []);

    expect(result.actualAmount).toBe('0.00');
    expect(result.variance).toBe('-300.00');
    expect(result.variancePercent).toBe('-100.00');
  });

  it('returns null ("n/a") for variancePercent when plannedAmount is exactly "0.00" — never a divide-by-zero', () => {
    const lines: BudgetVarianceLineInput[] = [
      {
        accountId: 'acc-618900',
        accountNumber: '618900',
        accountLabel: 'Divers',
        plannedAmount: '0.00',
      },
    ];
    const actuals: ActualAccountBalance[] = [{ accountId: 'acc-618900', balance: '150.00' }];

    const [result] = computeBudgetVariance(lines, actuals);

    expect(result.plannedAmount).toBe('0.00');
    expect(result.actualAmount).toBe('150.00');
    expect(result.variance).toBe('150.00');
    expect(result.variancePercent).toBeNull();
  });

  it('matches exactly (variance "0.00", variancePercent "0.00") when actual equals plan', () => {
    const lines: BudgetVarianceLineInput[] = [
      {
        accountId: 'acc-613200',
        accountNumber: '613200',
        accountLabel: 'Locations',
        plannedAmount: '1000.00',
      },
    ];
    const actuals: ActualAccountBalance[] = [{ accountId: 'acc-613200', balance: '1000.00' }];

    const [result] = computeBudgetVariance(lines, actuals);

    expect(result.variance).toBe('0.00');
    expect(result.variancePercent).toBe('0.00');
  });

  it('computes each line independently across several accounts, never cross-contaminating', () => {
    const lines: BudgetVarianceLineInput[] = [
      {
        accountId: 'acc-613200',
        accountNumber: '613200',
        accountLabel: 'Locations',
        plannedAmount: '1000.00',
      },
      {
        accountId: 'acc-707000',
        accountNumber: '707000',
        accountLabel: 'Ventes',
        plannedAmount: '50000.00',
      },
    ];
    const actuals: ActualAccountBalance[] = [
      { accountId: 'acc-613200', balance: '1200.00' },
      { accountId: 'acc-707000', balance: '-45000.00' },
    ];

    const results = computeBudgetVariance(lines, actuals);

    expect(results).toHaveLength(2);
    expect(results[0].accountNumber).toBe('613200');
    expect(results[0].variance).toBe('200.00');
    expect(results[1].accountNumber).toBe('707000');
    expect(results[1].variance).toBe('-5000.00');
  });
});

describe('computeBudgetVarianceTotals', () => {
  it('sums each column independently across lines, never re-deriving a line from the total', () => {
    const lines: BudgetVarianceLineInput[] = [
      {
        accountId: 'acc-613200',
        accountNumber: '613200',
        accountLabel: 'Locations',
        plannedAmount: '1000.00',
      },
      {
        accountId: 'acc-707000',
        accountNumber: '707000',
        accountLabel: 'Ventes',
        plannedAmount: '50000.00',
      },
    ];
    const actuals: ActualAccountBalance[] = [
      { accountId: 'acc-613200', balance: '1200.00' },
      { accountId: 'acc-707000', balance: '-45000.00' },
    ];
    const variance = computeBudgetVariance(lines, actuals);

    const totals = computeBudgetVarianceTotals(variance);

    // 1000.00 + 50000.00 = 51000.00 planned; 1200.00 + 45000.00 = 46200.00 actual.
    expect(totals.plannedAmount).toBe('51000.00');
    expect(totals.actualAmount).toBe('46200.00');
    expect(totals.variance).toBe('-4800.00'); // 46200.00 - 51000.00
    expect(totals.variancePercent).toBe('-9.41'); // -4800.00 / 51000.00 * 100, rounded
  });

  it('returns null variancePercent when the total plannedAmount is exactly "0.00"', () => {
    const lines: BudgetVarianceLineInput[] = [
      {
        accountId: 'acc-618900',
        accountNumber: '618900',
        accountLabel: 'Divers',
        plannedAmount: '0.00',
      },
    ];
    const variance = computeBudgetVariance(lines, []);

    const totals = computeBudgetVarianceTotals(variance);

    expect(totals.plannedAmount).toBe('0.00');
    expect(totals.variancePercent).toBeNull();
  });

  it('returns all-zero totals for an empty line list', () => {
    const totals = computeBudgetVarianceTotals([]);
    expect(totals).toEqual({
      plannedAmount: '0.00',
      actualAmount: '0.00',
      variance: '0.00',
      variancePercent: null,
    });
  });
});
