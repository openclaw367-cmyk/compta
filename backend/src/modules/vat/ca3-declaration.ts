import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';

/**
 * French CA3 (régime réel normal), basic-case computation — see
 * specs/vat-ca3-implementation-spec.md for the full line spec, mapping
 * table, and the decisions this implements. Everything not listed there
 * as implemented (DOM, Corse, produits pétroliers, AIC/imports beyond
 * the informational lines, groupe TVA, régularisations, annexe 3310-A,
 * accise sur les énergies) is out of scope and throws rather than being
 * silently mis-declared.
 */

/** Ligne 19 — biens constituant des immobilisations (déductible), unambiguous, no rate split. */
const DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT = '445662';
/** Ligne 20 — autres biens et services (déductible), unambiguous, no rate split. */
const DEDUCTIBLE_AUTRES_ACCOUNT = '445660';
/** Lignes 08/09/9B/T6 (collectée) — any account under 4457, not hardcoded to one id. */
const COLLECTEE_PREFIX = '4457';
/** Other 4456-prefixed accounts aren't mapped to a CA3 line yet. */
const DEDUCTIBLE_PREFIX = '4456';
/** Revenue lines feeding the base-HT-by-rate figures (lignes 08/09/9B/T6's "Base hors taxe" column). */
const REVENUE_PCG_CLASS = 7;

interface ImplementedRate {
  /** CA3 line code, e.g. "08", "9B", "T6". */
  ligne: string;
  label: string;
  ratePercent: Money;
}

/**
 * The four rates implemented now: the three standard Cadre B rates
 * (08/09/9B) plus T6 (2,1 % France continentale), per the confirmed
 * decision to treat T6 as a standard rate rather than deferring it with
 * the rest of "taux particuliers" (DOM/Corse/produits pétroliers stay
 * deferred).
 */
const IMPLEMENTED_RATES: ImplementedRate[] = [
  { ligne: '08', label: 'Taux normal 20 %', ratePercent: Money.fromString('20.00') },
  { ligne: '9B', label: 'Taux réduit 10 %', ratePercent: Money.fromString('10.00') },
  { ligne: '09', label: 'Taux réduit 5,5 %', ratePercent: Money.fromString('5.50') },
  { ligne: 'T6', label: 'Taux réduit 2,1 % (France continentale)', ratePercent: Money.fromString('2.10') },
];

export interface Ca3Ligne {
  compteNumber: string;
  pcgClass: number;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  vatRateId: string | null;
}

export interface Ca3VatRate {
  id: string;
  ratePercent: Prisma.Decimal;
}

export interface Ca3RateLine {
  ligne: string;
  label: string;
  ratePercent: string;
  /** Money string, rounded to the nearest euro (see roundToNearestEuro). */
  baseHT: string;
  /** Money string, rounded to the nearest euro. */
  taxe: string;
}

export interface Ca3Declaration {
  periodStart: string;
  periodEnd: string;
  collecteeByRate: Ca3RateLine[];
  /** Ligne 16 — total de la TVA brute due (implemented scope: sum of collecteeByRate). Money string. */
  ligne16: string;
  /** Ligne 19 — biens constituant des immobilisations. Money string. */
  ligne19: string;
  /** Ligne 20 — autres biens et services. Money string. */
  ligne20: string;
  /** Ligne 23 — total TVA déductible (19 + 20, implemented scope). Money string. */
  ligne23: string;
  /** Ligne 25 — crédit de TVA (23 − 16), only when 23 > 16. Money string, null otherwise. */
  ligne25: string | null;
  /** Ligne TD — TVA due (16 − 23), only when 16 ≥ 23. Money string, null otherwise. */
  ligneTD: string | null;
  /** Ligne 28 — TVA nette due (implemented scope: ligneTD, or "0.00" in a credit period). Money string. */
  ligne28: string;
  /** Ligne 32 — total à payer (implemented scope: ligne28). Money string. */
  ligne32: string;
}

/**
 * Rounds to the nearest euro: fractions below 0,50 are dropped, 0,50 and
 * above round up (Article A47 A-1-style rule, but for VAT: CA3 notice
 * p.1/p.6/p.9, and Monaco Ordonnance Souveraine n°13.844 art. 1er —
 * identical rule, independently cited on both sides). Declaration-line
 * boundary only — never applied to a ledger value.
 */
function roundToNearestEuro(amount: Money): Money {
  const rounded = amount.toDecimal().toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return Money.fromString(rounded.toFixed(2));
}

function assertNotNegative(amount: Money, description: string): void {
  if (amount.isNegative()) {
    throw new ConflictException(
      `${description} computed as ${amount.toApiString()}, which is negative — the CA3 notice is ` +
        'explicit that no line may show a negative amount ("Ne jamais indiquer de sommes ' +
        'négatives"). This usually means a régularisation (deferred, not implemented) is needed.',
    );
  }
}

function findImplementedRate(ratePercent: Money): ImplementedRate {
  const match = IMPLEMENTED_RATES.find((r) => r.ratePercent.equals(ratePercent));
  if (!match) {
    throw new BadRequestException(
      `VAT rate ${ratePercent.toApiString()}% is not one of the currently-implemented CA3 rates ` +
        `(${IMPLEMENTED_RATES.map((r) => r.ratePercent.toApiString()).join('%, ')}%) — it falls under ` +
        "a deferred category (DOM, Corse, produits pétroliers, or another taux particulier). See " +
        'specs/vat-ca3-implementation-spec.md.',
    );
  }
  return match;
}

/**
 * Pure computation: takes already-fetched, period-scoped, validated-only
 * ledger lines and the company's VAT rates, returns the CA3 declaration.
 * No I/O — VatService.computeDeclaration() is a thin wrapper that fetches
 * these and calls this function, so the arithmetic here is testable
 * directly against a hand-computed oracle (see ca3-declaration.spec.ts).
 */
export function computeCa3Declaration(
  lignes: Ca3Ligne[],
  vatRates: Ca3VatRate[],
  periodStart: string,
  periodEnd: string,
): Ca3Declaration {
  const ratesById = new Map(vatRates.map((r) => [r.id, Money.fromDecimal(r.ratePercent)]));

  const buckets = new Map<string, { rate: ImplementedRate; baseHT: Money; taxe: Money }>(
    IMPLEMENTED_RATES.map((rate) => [rate.ligne, { rate, baseHT: Money.zero(), taxe: Money.zero() }]),
  );

  function resolveBucket(vatRateId: string) {
    const ratePercent = ratesById.get(vatRateId);
    if (!ratePercent) {
      throw new BadRequestException(`VAT rate ${vatRateId} referenced by a ledger line was not found.`);
    }
    const implemented = findImplementedRate(ratePercent);
    return buckets.get(implemented.ligne)!;
  }

  let ligne19 = Money.zero();
  let ligne20 = Money.zero();

  for (const ligne of lignes) {
    const debit = Money.fromDecimal(ligne.debit);
    const credit = Money.fromDecimal(ligne.credit);
    const isCollectee = ligne.compteNumber.startsWith(COLLECTEE_PREFIX);
    const isDeductibleImmo = ligne.compteNumber === DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT;
    const isDeductibleAutres = ligne.compteNumber === DEDUCTIBLE_AUTRES_ACCOUNT;

    if (isCollectee) {
      if (!ligne.vatRateId) {
        throw new BadRequestException(
          `Account "${ligne.compteNumber}" (TVA collectée) has a line with no vatRateId — every ` +
            'collectée line must be tagged with a rate before a declaration can be computed.',
        );
      }
      const bucket = resolveBucket(ligne.vatRateId);
      bucket.taxe = bucket.taxe.plus(credit).minus(debit);
      continue;
    }

    if (isDeductibleImmo) {
      ligne19 = ligne19.plus(debit).minus(credit);
      continue;
    }
    if (isDeductibleAutres) {
      ligne20 = ligne20.plus(debit).minus(credit);
      continue;
    }
    if (ligne.compteNumber.startsWith(DEDUCTIBLE_PREFIX)) {
      throw new BadRequestException(
        `Account "${ligne.compteNumber}" is a TVA déductible account not yet mapped to a CA3 line ` +
          `(only ${DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT} and ${DEDUCTIBLE_AUTRES_ACCOUNT} are supported).`,
      );
    }

    if (ligne.pcgClass === REVENUE_PCG_CLASS && ligne.vatRateId) {
      const bucket = resolveBucket(ligne.vatRateId);
      bucket.baseHT = bucket.baseHT.plus(credit).minus(debit);
      continue;
    }
    // Anything else (bank, tiers, untagged revenue, ...) has no bearing on this declaration.
  }

  assertNotNegative(ligne19, 'Ligne 19 (biens constituant des immobilisations)');
  assertNotNegative(ligne20, 'Ligne 20 (autres biens et services)');
  for (const { rate, baseHT, taxe } of buckets.values()) {
    assertNotNegative(baseHT, `Base HT for ${rate.label} (ligne ${rate.ligne})`);
    assertNotNegative(taxe, `TVA collectée for ${rate.label} (ligne ${rate.ligne})`);
  }

  const ligne16 = IMPLEMENTED_RATES.reduce(
    (sum, rate) => sum.plus(buckets.get(rate.ligne)!.taxe),
    Money.zero(),
  );
  const ligne23 = ligne19.plus(ligne20);

  const isCredit = ligne23.minus(ligne16).isPositive();
  const ligne25 = isCredit ? ligne23.minus(ligne16) : null;
  const ligneTD = isCredit ? null : ligne16.minus(ligne23);
  const ligne28 = ligneTD ?? Money.zero();
  const ligne32 = ligne28;

  return {
    periodStart,
    periodEnd,
    collecteeByRate: IMPLEMENTED_RATES.map((rate) => {
      const bucket = buckets.get(rate.ligne)!;
      return {
        ligne: rate.ligne,
        label: rate.label,
        ratePercent: rate.ratePercent.toApiString(),
        baseHT: roundToNearestEuro(bucket.baseHT).toApiString(),
        taxe: roundToNearestEuro(bucket.taxe).toApiString(),
      };
    }),
    ligne16: roundToNearestEuro(ligne16).toApiString(),
    ligne19: roundToNearestEuro(ligne19).toApiString(),
    ligne20: roundToNearestEuro(ligne20).toApiString(),
    ligne23: roundToNearestEuro(ligne23).toApiString(),
    ligne25: ligne25 ? roundToNearestEuro(ligne25).toApiString() : null,
    ligneTD: ligneTD ? roundToNearestEuro(ligneTD).toApiString() : null,
    ligne28: roundToNearestEuro(ligne28).toApiString(),
    ligne32: roundToNearestEuro(ligne32).toApiString(),
  };
}
