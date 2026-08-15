import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import { computeAnnualDotationAmount } from './depreciation-schedule';

/**
 * Prorata temporis for a mid-year disposal — the final, partial-period
 * dotation an asset needs before its VNC at cession can be computed. See
 * CLAUDE.md's "Immobilisations / cession" section for the decision this
 * implements: a 30E/360 ("commercial year", every month = 30 days)
 * day-count, counted from date de mise en service, applied symmetrically
 * to any future acquisition-year proration too (not built yet —
 * depreciation-schedule.ts's computeLinearSchedule still throws on a
 * partially-overlapping fiscal year; only the DISPOSAL side of this same
 * gap is closed here).
 *
 * Days are counted INCLUSIVE of both endpoints (the day of period-start
 * and the day of cession both count as a day of use) — this is a
 * deliberate choice, not the exclusive interest-accrual convention some
 * finance day-counts use, because the day-count function is being asked
 * "how many days was this asset in service", not "how many days of
 * interest accrued between two settlement dates". One consequence,
 * checked by a test: a disposal that lands exactly on a fiscal year's own
 * last day reproduces (to within a cent or two of standard 30/360
 * boundary rounding) the same amount a normal full-year dotation would
 * have given.
 */

/**
 * European 30/360 (30E/360) day-count between two dates, inclusive of
 * both endpoints. Each month is treated as having 30 days (day 31 is
 * clamped to 30 on both ends) — the standard "commercial year"
 * simplification, not calendar-exact day arithmetic.
 */
export function daysBetween360(start: Date, end: Date): number {
  if (end < start) {
    throw new Error(`daysBetween360: end (${end.toISOString()}) is before start (${start.toISOString()}).`);
  }
  const d1 = Math.min(start.getUTCDate(), 30);
  const d2 = Math.min(end.getUTCDate(), 30);
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  return months * 30 + (d2 - d1) + 1;
}

/**
 * The disposal fiscal year's own dotation, prorated by day-count from
 * `periodStart` (the later of the fiscal year's own start and the
 * asset's serviceStartDate — handles the edge case of an asset acquired
 * and disposed within the same fiscal year) through `cessionDate`.
 *
 * Deliberately does NOT reuse computeLinearSchedule's "last year absorbs
 * the rounding remainder" logic: that logic exists to make a FULL
 * theoretical schedule sum to exactly the depreciable base over
 * usefulLifeYears years. A disposed asset never reaches that full
 * schedule — there is no "remainder" to absorb, since the schedule is
 * being deliberately truncated early. Every period (including this
 * final one) is instead prorated independently off the same flat
 * `computeAnnualDotationAmount()` figure. This can leave a residual
 * cent or two of VNC uncleared by rounding drift in the (comparatively
 * rare) case where disposal happens to land on what would have been the
 * asset's theoretical final day — that residual isn't hidden: it flows
 * straight into the cession's own plus/moins-value (675/775), the same
 * way any other rounding artifact in this codebase surfaces rather than
 * being silently absorbed.
 */
export function computeFinalPeriodDotation(
  asset: {
    acquisitionValue: Prisma.Decimal;
    residualValue: Prisma.Decimal;
    usefulLifeYears: number;
  },
  periodStart: Date,
  cessionDate: Date,
): Money {
  if (cessionDate < periodStart) {
    throw new Error(
      `computeFinalPeriodDotation: cessionDate (${cessionDate.toISOString()}) is before periodStart ` +
        `(${periodStart.toISOString()}).`,
    );
  }
  const annualAmount = computeAnnualDotationAmount(asset);
  const days = daysBetween360(periodStart, cessionDate);
  return Money.fromString(annualAmount.times(days).dividedBy(360).toApiString());
}
