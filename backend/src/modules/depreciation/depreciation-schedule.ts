import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';

export interface FixedAssetForSchedule {
  acquisitionValue: Prisma.Decimal;
  residualValue: Prisma.Decimal;
  usefulLifeYears: number;
  serviceStartDate: Date;
}

export interface FiscalYearForSchedule {
  id: string;
  startDate: Date;
  endDate: Date;
}

export interface ScheduleLine {
  fiscalYearId: string;
  amount: Money;
}

/**
 * The flat full-year dotation amount — base ÷ usefulLifeYears, rounded to
 * 2 decimals immediately (matching NUMERIC(15,2) storage). Shared between
 * the normal schedule (below, where the LAST year additionally absorbs
 * whatever rounding remainder is left) and cession-proration.ts's final-
 * period calculation (which prorates this same flat amount by a day-count
 * fraction — see that module's doc comment for why it does NOT use the
 * last-year-absorbs-remainder logic).
 */
export function computeAnnualDotationAmount(asset: {
  acquisitionValue: Prisma.Decimal;
  residualValue: Prisma.Decimal;
  usefulLifeYears: number;
}): Money {
  const base = Money.fromDecimal(asset.acquisitionValue).minus(
    Money.fromDecimal(asset.residualValue),
  );
  if (!base.isPositive()) {
    throw new Error('Depreciable base (acquisitionValue - residualValue) must be positive.');
  }
  return Money.fromString(base.dividedBy(asset.usefulLifeYears).toApiString());
}

/**
 * Straight-line (linéaire) depreciation only — declining-balance
 * (dégressif) is not implemented (see DepreciationService). Only handles
 * fiscal years fully contained within the asset's depreciation window
 * (serviceStartDate to serviceStartDate + usefulLifeYears): a fiscal year
 * that only partially overlaps that window — the common case for a
 * mid-year acquisition, which needs prorata temporis — is not handled.
 * This throws rather than silently producing an approximate amount; see
 * CLAUDE.md's "no silent fallbacks on compliance-relevant logic" rule.
 * (Cession — the mid-year DISPOSAL analog of this same gap — IS handled,
 * by cession-proration.ts's computeFinalPeriodDotation(); acquisition-year
 * proration remains this function's own open gap.)
 *
 * The last covered fiscal year absorbs whatever rounding remainder is
 * left so the schedule always sums to exactly `acquisitionValue -
 * residualValue`, never drifting by a cent due to per-year rounding.
 */
export function computeLinearSchedule(
  asset: FixedAssetForSchedule,
  fiscalYears: FiscalYearForSchedule[],
): ScheduleLine[] {
  const base = Money.fromDecimal(asset.acquisitionValue).minus(
    Money.fromDecimal(asset.residualValue),
  );
  if (!base.isPositive()) {
    throw new Error('Depreciable base (acquisitionValue - residualValue) must be positive.');
  }

  const depreciationEnd = new Date(asset.serviceStartDate);
  depreciationEnd.setUTCFullYear(depreciationEnd.getUTCFullYear() + asset.usefulLifeYears);

  for (const fiscalYear of fiscalYears) {
    const overlaps =
      fiscalYear.endDate > asset.serviceStartDate && fiscalYear.startDate < depreciationEnd;
    const fullyContained =
      fiscalYear.startDate >= asset.serviceStartDate && fiscalYear.endDate <= depreciationEnd;
    if (overlaps && !fullyContained) {
      throw new Error(
        `Fiscal year ${fiscalYear.id} only partially overlaps the asset's depreciation window; ` +
          'prorata temporis is not implemented yet (see depreciation-schedule.ts).',
      );
    }
  }

  const relevantYears = fiscalYears
    .filter((fy) => fy.startDate >= asset.serviceStartDate && fy.endDate <= depreciationEnd)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  if (relevantYears.length !== asset.usefulLifeYears) {
    throw new Error(
      `Expected exactly ${asset.usefulLifeYears} fiscal year(s) covering the depreciation window, ` +
        `found ${relevantYears.length}.`,
    );
  }

  // Rounded to 2 decimals immediately (matching NUMERIC(15,2) storage) by
  // computeAnnualDotationAmount, so the last-year remainder below is
  // computed against the same rounded values that actually get persisted
  // — otherwise per-year rounding at the DB layer could leave the
  // schedule a cent short or over.
  const annualAmount = computeAnnualDotationAmount(asset);
  let allocated = Money.zero();

  return relevantYears.map((fiscalYear, index) => {
    const isLast = index === relevantYears.length - 1;
    const amount = isLast ? base.minus(allocated) : annualAmount;
    allocated = allocated.plus(amount);
    return { fiscalYearId: fiscalYear.id, amount };
  });
}
