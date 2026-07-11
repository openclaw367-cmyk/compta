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
 * Straight-line (linéaire) depreciation only — declining-balance
 * (dégressif) is not implemented (see DepreciationService). Only handles
 * fiscal years fully contained within the asset's depreciation window
 * (serviceStartDate to serviceStartDate + usefulLifeYears): a fiscal year
 * that only partially overlaps that window — the common case for a
 * mid-year acquisition, which needs prorata temporis — is not handled.
 * This throws rather than silently producing an approximate amount; see
 * CLAUDE.md's "no silent fallbacks on compliance-relevant logic" rule.
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

  // Round to 2 decimals immediately (matching NUMERIC(15,2) storage), so
  // the last-year remainder below is computed against the same rounded
  // values that actually get persisted — otherwise per-year rounding at
  // the DB layer could leave the schedule a cent short or over.
  const annualAmount = Money.fromString(base.dividedBy(asset.usefulLifeYears).toApiString());
  let allocated = Money.zero();

  return relevantYears.map((fiscalYear, index) => {
    const isLast = index === relevantYears.length - 1;
    const amount = isLast ? base.minus(allocated) : annualAmount;
    allocated = allocated.plus(amount);
    return { fiscalYearId: fiscalYear.id, amount };
  });
}
