import { Money } from '../../common/decimal';
import {
  addMonths,
  computeSpendingAnomalies,
  monthKey,
  monthsBetween,
  type AccountMonthlySeries,
} from './spending-anomaly-engine';

function series(months: Record<string, string>): AccountMonthlySeries {
  return {
    accountId: 'acc-606400',
    accountNumber: '606400',
    accountLabel: 'Fournitures administratives',
    months: Object.entries(months).map(([month, amount]) => ({
      month,
      amount: Money.fromString(amount),
    })),
  };
}

describe('computeSpendingAnomalies', () => {
  it('flags a month at exactly 2× a clean 6-month trailing average', () => {
    const s = series({
      '2026-01': '100.00',
      '2026-02': '100.00',
      '2026-03': '100.00',
      '2026-04': '100.00',
      '2026-05': '100.00',
      '2026-06': '100.00',
      '2026-07': '250.00',
    });
    const result = computeSpendingAnomalies([s], ['2026-07']);
    expect(result).toEqual([
      {
        accountId: 'acc-606400',
        accountNumber: '606400',
        accountLabel: 'Fournitures administratives',
        month: '2026-07',
        currentAmount: '250.00',
        trailingAverage: '100.00',
        multiplier: '2.50',
        monthsOfHistory: 6,
      },
    ]);
  });

  it('does not flag a month just under the multiplier threshold', () => {
    const s = series({
      '2026-01': '100.00',
      '2026-02': '100.00',
      '2026-03': '100.00',
      '2026-04': '100.00',
      '2026-05': '100.00',
      '2026-06': '100.00',
      '2026-07': '199.99',
    });
    expect(computeSpendingAnomalies([s], ['2026-07'])).toEqual([]);
  });

  it('flags exactly at the threshold boundary (>=, not >)', () => {
    const s = series({
      '2026-01': '100.00',
      '2026-02': '100.00',
      '2026-03': '100.00',
      '2026-04': '100.00',
      '2026-05': '100.00',
      '2026-06': '100.00',
      '2026-07': '200.00',
    });
    const result = computeSpendingAnomalies([s], ['2026-07']);
    expect(result).toHaveLength(1);
    expect(result[0].multiplier).toBe('2.00');
  });

  it('skips a month with too little history (fewer than 3 nonzero trailing months)', () => {
    const s = series({
      '2026-05': '100.00',
      '2026-06': '100.00',
      '2026-07': '5000.00',
    });
    expect(computeSpendingAnomalies([s], ['2026-07'])).toEqual([]);
  });

  it('skips a month with zero current-month activity — nothing to flag', () => {
    const s = series({
      '2026-01': '100.00',
      '2026-02': '100.00',
      '2026-03': '100.00',
      // 2026-07 absent entirely (treated as zero)
    });
    expect(computeSpendingAnomalies([s], ['2026-07'])).toEqual([]);
  });

  it('scans multiple accounts independently — one spikes, one stays within its own normal range', () => {
    const spiking = series({
      '2026-01': '100.00',
      '2026-02': '100.00',
      '2026-03': '100.00',
      '2026-04': '100.00',
      '2026-05': '100.00',
      '2026-06': '100.00',
      '2026-07': '500.00',
    });
    const steady: AccountMonthlySeries = {
      accountId: 'acc-616000',
      accountNumber: '616000',
      accountLabel: "Primes d'assurances",
      months: [
        { month: '2026-01', amount: Money.fromString('50.00') },
        { month: '2026-02', amount: Money.fromString('50.00') },
        { month: '2026-03', amount: Money.fromString('50.00') },
        { month: '2026-04', amount: Money.fromString('50.00') },
        { month: '2026-05', amount: Money.fromString('50.00') },
        { month: '2026-06', amount: Money.fromString('50.00') },
        { month: '2026-07', amount: Money.fromString('55.00') },
      ],
    };
    const result = computeSpendingAnomalies([spiking, steady], ['2026-07']);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      accountId: 'acc-606400',
      month: '2026-07',
      multiplier: '5.00',
    });
  });
});

describe('month arithmetic helpers', () => {
  it('monthKey formats a Date as YYYY-MM', () => {
    expect(monthKey(new Date(2026, 8, 5))).toBe('2026-09');
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01');
  });

  it('addMonths rolls over year boundaries in both directions', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-06', -6)).toBe('2025-12');
  });

  it('monthsBetween is inclusive and chronological', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });
});
