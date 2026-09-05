import { Money } from '../../common/decimal';

/**
 * How many trailing calendar months feed the "normal" average, how many
 * of those must have SOME activity before a baseline is trusted, and how
 * many times over that average counts as a deviation worth flagging.
 * Deliberately a simple trailing-average + fixed-multiplier rule, not a
 * statistical z-score — easy to explain to a non-technical bookkeeper
 * ("2.4× your usual monthly spend on this account"). Documented,
 * provisional, first thing to revisit against real data once this
 * ships — same framing as `DATE_WINDOW_DAYS` in
 * bank-reconciliation/matching-engine.ts.
 *
 * `MIN_HISTORY_MONTHS` must stay strictly greater than
 * `TRAILING_MONTHS / MULTIPLIER` (here 6/2=3) — found by hand-tracing a
 * test case, not by inspection: at exactly `TRAILING_MONTHS / MULTIPLIER`
 * months of history, a perfectly FLAT recurring expense's own ratio
 * (`TRAILING_MONTHS / historyMonths`) equals `MULTIPLIER` exactly, so a
 * brand-new, non-deviating monthly charge would be falsely flagged the
 * very first month it became eligible at all. 4 keeps every flat series
 * safely under threshold (6/4 = 1.5 < 2) regardless of how new it is.
 */
export const TRAILING_MONTHS = 6;
export const MIN_HISTORY_MONTHS = 4;
export const MULTIPLIER = 2;

export interface AccountMonthAmount {
  /** YYYY-MM */
  month: string;
  amount: Money;
}

export interface AccountMonthlySeries {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** One entry per month that had ANY activity — gaps mean zero, not missing data. */
  months: AccountMonthAmount[];
}

export interface SpendingAnomaly {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** YYYY-MM */
  month: string;
  currentAmount: string;
  trailingAverage: string;
  /** A dimensionless ratio (current ÷ trailingAverage), not money — computed via Decimal's own
   *  arbitrary-precision division, never native JS float division (same discipline as
   *  financial-analysis.ts's own ratios). */
  multiplier: string;
  monthsOfHistory: number;
}

/** `"2026-03"` → 24339 (a flat month index, for arithmetic only — never displayed). */
function toFlatMonth(monthKeyStr: string): number {
  const [year, month] = monthKeyStr.split('-').map(Number);
  return year * 12 + (month - 1);
}

function fromFlatMonth(flat: number): string {
  const year = Math.floor(flat / 12);
  const month = (flat % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(monthKeyStr: string, delta: number): string {
  return fromFlatMonth(toFlatMonth(monthKeyStr) + delta);
}

/** Inclusive, chronological list of every month from `start` to `end`. */
export function monthsBetween(start: string, end: string): string[] {
  const startFlat = toFlatMonth(start);
  const endFlat = toFlatMonth(end);
  const months: string[] = [];
  for (let flat = startFlat; flat <= endFlat; flat += 1) {
    months.push(fromFlatMonth(flat));
  }
  return months;
}

function trailingMonthsBefore(month: string, count: number): string[] {
  const months: string[] = [];
  for (let i = count; i >= 1; i -= 1) {
    months.push(addMonths(month, -i));
  }
  return months;
}

/**
 * Pure, stateless — same "engine has zero I/O, the caller does the
 * Prisma fetch" split as bank-reconciliation/matching-engine.ts.
 * `evaluatedMonths` is caller-supplied (typically every month within a
 * fiscal year that's already elapsed) rather than derived here, keeping
 * this function trivial to test against hand-picked scenarios.
 */
export function computeSpendingAnomalies(
  series: AccountMonthlySeries[],
  evaluatedMonths: string[],
): SpendingAnomaly[] {
  const anomalies: SpendingAnomaly[] = [];

  for (const account of series) {
    const byMonth = new Map(account.months.map((m) => [m.month, m.amount]));

    for (const month of evaluatedMonths) {
      const current = byMonth.get(month) ?? Money.zero();
      if (current.isZero()) continue;

      const trailingAmounts = trailingMonthsBefore(month, TRAILING_MONTHS).map(
        (m) => byMonth.get(m) ?? Money.zero(),
      );
      const monthsOfHistory = trailingAmounts.filter((a) => !a.isZero()).length;
      if (monthsOfHistory < MIN_HISTORY_MONTHS) continue;

      const sum = trailingAmounts.reduce((acc, a) => acc.plus(a), Money.zero());
      const average = sum.dividedBy(TRAILING_MONTHS);
      // Unreachable in practice once monthsOfHistory >= MIN_HISTORY_MONTHS (debit/credit are
      // never negative, so >=3 nonzero months guarantee a positive sum) — kept as a defensive
      // guard against a divide-by-zero-shaped multiplier, not a scenario this needs its own test.
      if (average.isZero()) continue;

      const diff = current.minus(average.times(MULTIPLIER));
      if (diff.isNegative()) continue;

      anomalies.push({
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        accountLabel: account.accountLabel,
        month,
        currentAmount: current.toApiString(),
        trailingAverage: average.toApiString(),
        multiplier: current.toDecimal().dividedBy(average.toDecimal()).toFixed(2),
        monthsOfHistory,
      });
    }
  }

  return anomalies;
}
