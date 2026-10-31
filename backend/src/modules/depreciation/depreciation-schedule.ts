import { BadRequestException } from '@nestjs/common';
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
    throw new BadRequestException(
      'Depreciable base (acquisitionValue - residualValue) must be positive.',
    );
  }
  return Money.fromString(base.dividedBy(asset.usefulLifeYears).toApiString());
}

/**
 * Only handles fiscal years fully contained within the asset's
 * depreciation window (serviceStartDate to serviceStartDate +
 * usefulLifeYears): a fiscal year that only partially overlaps that
 * window — the common case for a mid-year acquisition, which needs
 * prorata temporis — is not handled. Shared by computeLinearSchedule()
 * and computeDecliningSchedule() below, both of which have this exact
 * same restriction and throw rather than silently producing an
 * approximate amount; see CLAUDE.md's "no silent fallbacks on
 * compliance-relevant logic" rule. (Cession — the mid-year DISPOSAL
 * analog of this same gap — IS handled, by cession-proration.ts's
 * computeFinalPeriodDotation(); acquisition-year proration remains open
 * for both depreciation methods.)
 */
function assertFullyContainedFiscalYears(
  asset: FixedAssetForSchedule,
  fiscalYears: FiscalYearForSchedule[],
  depreciationEnd: Date,
): void {
  for (const fiscalYear of fiscalYears) {
    const overlaps =
      fiscalYear.endDate > asset.serviceStartDate && fiscalYear.startDate < depreciationEnd;
    const fullyContained =
      fiscalYear.startDate >= asset.serviceStartDate && fiscalYear.endDate <= depreciationEnd;
    if (overlaps && !fullyContained) {
      throw new BadRequestException(
        `Fiscal year ${fiscalYear.id} only partially overlaps the asset's depreciation window; ` +
          'prorata temporis is not implemented yet (see depreciation-schedule.ts).',
      );
    }
  }
}

/**
 * Straight-line (linéaire) depreciation. See computeDecliningSchedule()
 * below for the declining-balance (dégressif) method.
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
    throw new BadRequestException(
      'Depreciable base (acquisitionValue - residualValue) must be positive.',
    );
  }

  const depreciationEnd = new Date(asset.serviceStartDate);
  depreciationEnd.setUTCFullYear(depreciationEnd.getUTCFullYear() + asset.usefulLifeYears);

  assertFullyContainedFiscalYears(asset, fiscalYears, depreciationEnd);

  const relevantYears = fiscalYears
    .filter((fy) => fy.startDate >= asset.serviceStartDate && fy.endDate <= depreciationEnd)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  if (relevantYears.length !== asset.usefulLifeYears) {
    throw new BadRequestException(
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

/**
 * The declining-balance coefficient by useful life, per CGI art. 39 A /
 * Annexe III (the standard table in force since the post-2001 reform —
 * NOT the older 1.5/2/2.5 table some pre-2001 sources still cite): 1.25
 * for 3-4 years, 1.75 for 5-6 years, 2.25 for more than 6 years. Below 3
 * years dégressif doesn't apply at all under French law — thrown rather
 * than guessed, same "never silently approximate" discipline as
 * everywhere else in this module.
 */
export function resolveDecliningCoefficient(usefulLifeYears: number): string {
  if (usefulLifeYears < 3) {
    throw new BadRequestException(
      `Declining-balance (dégressif) depreciation requires a useful life of at least 3 years ` +
        `(CGI art. 39 A) — this asset's usefulLifeYears is ${usefulLifeYears}.`,
    );
  }
  if (usefulLifeYears <= 4) return '1.25';
  if (usefulLifeYears <= 6) return '1.75';
  return '2.25';
}

/**
 * Declining-balance (dégressif) depreciation — CGI art. 39 A / Annexe
 * III. Same fully-contained-fiscal-years restriction as
 * computeLinearSchedule() (see assertFullyContainedFiscalYears() above)
 * — mid-year acquisition proration is a separate, still-open gap for
 * BOTH methods, deliberately not attempted here. Dégressif's own
 * real-world first-year proration additionally uses a MONTH count (not
 * cession's day-count convention) — a genuinely different rule that
 * would need its own citation before being added, not conflated with
 * the linéaire proration gap this pass was not scoped to close either.
 *
 * Each year's dotation is `max(VNC restante × taux dégressif, VNC
 * restante ÷ années restantes)` — the second term is the textbook
 * switch-to-linéaire rule: once straight-lining the remaining balance
 * over the remaining years would depreciate faster than the dégressif
 * rate, that takes over for every remaining year. This is guaranteed to
 * stay switched once it switches (VNC and années restantes shrink in
 * lockstep), so taking the max fresh each year — rather than tracking a
 * "have we switched yet" flag — is correct, not just simpler. Each
 * candidate is rounded to 2 decimals (matching NUMERIC(15,2) storage)
 * BEFORE the comparison, so the comparison matches what will actually be
 * persisted, same reasoning as computeAnnualDotationAmount's own
 * immediate rounding.
 *
 * Verified by hand against the standard textbook example (10 000,00 €,
 * 5 years, coefficient 1.75 → 3 500,00 / 2 275,00 / 1 478,75 / 1 373,13 /
 * 1 373,12, switching to linéaire in year 4) — see this file's own spec.
 * The last covered fiscal year absorbs whatever rounding remainder is
 * left, same reasoning as computeLinearSchedule().
 */
export function computeDecliningSchedule(
  asset: FixedAssetForSchedule,
  fiscalYears: FiscalYearForSchedule[],
): ScheduleLine[] {
  const base = Money.fromDecimal(asset.acquisitionValue).minus(
    Money.fromDecimal(asset.residualValue),
  );
  if (!base.isPositive()) {
    throw new BadRequestException(
      'Depreciable base (acquisitionValue - residualValue) must be positive.',
    );
  }

  const coefficient = resolveDecliningCoefficient(asset.usefulLifeYears);
  const tauxDegressif = new Prisma.Decimal(1).dividedBy(asset.usefulLifeYears).times(coefficient);

  const depreciationEnd = new Date(asset.serviceStartDate);
  depreciationEnd.setUTCFullYear(depreciationEnd.getUTCFullYear() + asset.usefulLifeYears);

  assertFullyContainedFiscalYears(asset, fiscalYears, depreciationEnd);

  const relevantYears = fiscalYears
    .filter((fy) => fy.startDate >= asset.serviceStartDate && fy.endDate <= depreciationEnd)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  if (relevantYears.length !== asset.usefulLifeYears) {
    throw new BadRequestException(
      `Expected exactly ${asset.usefulLifeYears} fiscal year(s) covering the depreciation window, ` +
        `found ${relevantYears.length}.`,
    );
  }

  let vncRestante = base;
  let allocated = Money.zero();

  return relevantYears.map((fiscalYear, index) => {
    const isLast = index === relevantYears.length - 1;
    let amount: Money;
    if (isLast) {
      amount = base.minus(allocated);
    } else {
      const remainingYears = relevantYears.length - index;
      const degressifCandidate = Money.fromString(
        vncRestante.times(tauxDegressif.toString()).toDecimal().toFixed(2),
      );
      const lineaireCandidate = Money.fromString(
        vncRestante.dividedBy(remainingYears).toDecimal().toFixed(2),
      );
      amount = degressifCandidate.minus(lineaireCandidate).isPositive()
        ? degressifCandidate
        : lineaireCandidate;
    }
    allocated = allocated.plus(amount);
    vncRestante = vncRestante.minus(amount);
    return { fiscalYearId: fiscalYear.id, amount };
  });
}
