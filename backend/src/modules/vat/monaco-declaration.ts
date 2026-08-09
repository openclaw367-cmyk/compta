import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import { roundToNearestEuro } from './vat-rounding';

/**
 * Monaco DSF declaration, basic-case computation — see
 * specs/vat-monaco-implementation-spec.md for the full line spec,
 * divergence table, and exactly what's implemented vs. deferred. This is
 * a genuinely different declaration from the French CA3 — different
 * form, different tax authority, different line numbers — not a
 * variant, even though it happens to read the same PCG accounts (see
 * the spec's §5).
 *
 * Four rates implemented: the three named on ligne 32
 * (réduit/intermédiaire/normal) plus 2,1 % via ligne 30 — see the
 * IMPLEMENTED_RATES comment below for why 2,1 % belongs on 30, not a
 * dropped rate. Lignes 31 (anciens taux) and 34 (TVA antérieurement
 * déduite à reverser) stay deferred — genuinely different categories,
 * not re-litigated here. Lignes 20/22/23/24 (déductible) and 49/52/53
 * (TMP, acomptes provisionnels, compléments) are equally unresolved and
 * stay out — see the spec's open items before ever widening this.
 */

/** Ligne 44 — biens constituant des immobilisations (déductible), unambiguous, no rate split. */
const DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT = '445662';
/** Ligne 45 — autres biens et services (déductible), unambiguous, no rate split. */
const DEDUCTIBLE_AUTRES_ACCOUNT = '445660';
/** Lignes 30/32 (collectée) — any account under 4457, not hardcoded to one id. Same accounts as France, see spec §5. */
const COLLECTEE_PREFIX = '4457';
/** Other 4456-prefixed accounts aren't mapped to a Monaco line yet. */
const DEDUCTIBLE_PREFIX = '4456';
/** Revenue lines feeding the base-HT-by-rate figures (lignes 30/32's "Base hors taxe" column). */
const REVENUE_PCG_CLASS = 7;

interface ImplementedRate {
  /** "30" (taux particuliers, generic) or "32" (the three named standard rows) — see below. */
  ligne: '30' | '32';
  label: string;
  ratePercent: Money;
}

/**
 * Corrected after review: 2,1 % IS implemented, on ligne 30 — not
 * dropped the way an earlier pass concluded.
 *
 * The earlier conclusion ("no dedicated 2,1 % line, existence
 * unconfirmed") mistook the *absence of a pre-printed 2,1 % label* for
 * evidence the rate doesn't apply. Re-reading the actual form: ligne 30
 * reads *"Taux particuliers ___%"* — a blank, fillable percentage field
 * (confirmed by rendering the page, not just text extraction), the
 * generic slot for whatever non-standard rate applies, functionally
 * equivalent to how the French CA3 gives each taux particulier its own
 * named sub-line (T1, T6, ...) instead of one blank field. Combined with
 * the confirmed convention (CLAUDE.md "Monaco compliance": VAT largely
 * mirrors French rates under the 1963 Franco-Monégasque tax convention)
 * and that Monaco's rate set is confirmed to include 2,1 % (presse,
 * médicaments, same as France), ligne 30 is where a Monaco filer with
 * 2,1 %-rated activity would write "2,1" and declare it — not an
 * unconfirmed or dropped rate.
 *
 * Ligne 31 (anciens taux) and ligne 34 stay deferred — genuinely
 * different, unrelated categories, not affected by this correction.
 */
const IMPLEMENTED_RATES: ImplementedRate[] = [
  { ligne: '30', label: 'Taux particulier 2,1 %', ratePercent: Money.fromString('2.10') },
  { ligne: '32', label: 'Taux réduit', ratePercent: Money.fromString('5.50') },
  { ligne: '32', label: 'Taux intermédiaire', ratePercent: Money.fromString('10.00') },
  { ligne: '32', label: 'Taux normal', ratePercent: Money.fromString('20.00') },
];

export interface MonacoLigne {
  compteNumber: string;
  pcgClass: number;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  vatRateId: string | null;
}

export interface MonacoVatRate {
  id: string;
  ratePercent: Prisma.Decimal;
}

export interface MonacoRateLine {
  /** "30" for the 2,1 % taux particulier, "32" for the three named standard rows. */
  ligne: '30' | '32';
  label: string;
  ratePercent: string;
  /** Money string, rounded to the nearest euro. */
  baseHT: string;
  /** Money string, rounded to the nearest euro. */
  taxe: string;
}

export interface MonacoDeclaration {
  periodStart: string;
  periodEnd: string;
  collecteeByRate: MonacoRateLine[];
  /** Ligne B1 — total (implemented scope: ligne 30 + the three ligne 32 rows, not 31/34). Money string. */
  ligneB1: string;
  /** Ligne 44 — biens constituant des immobilisations. Money string. */
  ligne44: string;
  /** Ligne 45 — autres biens et services. Money string. */
  ligne45: string;
  /** Ligne B2 — total (implemented scope: 44 + 45, not 20/22/23/24). Money string. */
  ligneB2: string;
  /** Ligne B3 — crédit de TVA (B2 − B1), only when B2 > B1. Money string, null otherwise. */
  ligneB3: string | null;
  /** Ligne 48 — TVA nette due (B1 − B2), only when B1 ≥ B2. Money string, null otherwise. */
  ligne48: string | null;
  /** Ligne 60 — total à payer (implemented scope: ligne 48, or "0.00" in a credit period — 49/52/53 unresolved, not folded in). Money string. */
  ligne60: string;
}

function assertNotNegative(amount: Money, description: string): void {
  if (amount.isNegative()) {
    throw new ConflictException(
      `${description} computed as ${amount.toApiString()}, which is negative. This usually means a ` +
        'régularisation is needed — not implemented for Monaco yet, see ' +
        'specs/vat-monaco-implementation-spec.md.',
    );
  }
}

function findImplementedRate(ratePercent: Money): ImplementedRate {
  const match = IMPLEMENTED_RATES.find((r) => r.ratePercent.equals(ratePercent));
  if (!match) {
    throw new BadRequestException(
      `VAT rate ${ratePercent.toApiString()}% is not one of the currently-implemented Monaco rates ` +
        `(${IMPLEMENTED_RATES.map((r) => r.ratePercent.toApiString()).join('%, ')}%) — it would fall ` +
        'under ligne 31 (anciens taux), not implemented (see ' +
        'specs/vat-monaco-implementation-spec.md).',
    );
  }
  return match;
}

/**
 * Pure computation: takes already-fetched, period-scoped, validated-only
 * ledger lines and the company's VAT rates, returns the Monaco
 * declaration. No I/O — VatService.computeDeclaration() is a thin
 * wrapper that fetches these and calls this function for an
 * MC-jurisdiction company, so the arithmetic here is testable directly
 * against a hand-computed oracle (see monaco-declaration.spec.ts).
 */
export function computeMonacoDeclaration(
  lignes: MonacoLigne[],
  vatRates: MonacoVatRate[],
  periodStart: string,
  periodEnd: string,
): MonacoDeclaration {
  const ratesById = new Map(vatRates.map((r) => [r.id, Money.fromDecimal(r.ratePercent)]));

  const buckets = new Map<string, { rate: ImplementedRate; baseHT: Money; taxe: Money }>(
    IMPLEMENTED_RATES.map((rate) => [rate.label, { rate, baseHT: Money.zero(), taxe: Money.zero() }]),
  );

  function resolveBucket(vatRateId: string) {
    const ratePercent = ratesById.get(vatRateId);
    if (!ratePercent) {
      throw new BadRequestException(`VAT rate ${vatRateId} referenced by a ledger line was not found.`);
    }
    const implemented = findImplementedRate(ratePercent);
    return buckets.get(implemented.label)!;
  }

  let ligne44 = Money.zero();
  let ligne45 = Money.zero();

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
      ligne44 = ligne44.plus(debit).minus(credit);
      continue;
    }
    if (isDeductibleAutres) {
      ligne45 = ligne45.plus(debit).minus(credit);
      continue;
    }
    if (ligne.compteNumber.startsWith(DEDUCTIBLE_PREFIX)) {
      throw new BadRequestException(
        `Account "${ligne.compteNumber}" is a TVA déductible account not yet mapped to a Monaco ` +
          `line (only ${DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT} and ${DEDUCTIBLE_AUTRES_ACCOUNT} are supported).`,
      );
    }

    if (ligne.pcgClass === REVENUE_PCG_CLASS && ligne.vatRateId) {
      const bucket = resolveBucket(ligne.vatRateId);
      bucket.baseHT = bucket.baseHT.plus(credit).minus(debit);
      continue;
    }
    // Anything else (bank, tiers, untagged revenue, ...) has no bearing on this declaration.
  }

  assertNotNegative(ligne44, 'Ligne 44 (biens constituant des immobilisations)');
  assertNotNegative(ligne45, 'Ligne 45 (autres biens et services)');
  for (const { rate, baseHT, taxe } of buckets.values()) {
    assertNotNegative(baseHT, `Base HT for ${rate.label} (ligne ${rate.ligne})`);
    assertNotNegative(taxe, `Taxe due for ${rate.label} (ligne ${rate.ligne})`);
  }

  const ligneB1 = IMPLEMENTED_RATES.reduce(
    (sum, rate) => sum.plus(buckets.get(rate.label)!.taxe),
    Money.zero(),
  );
  const ligneB2 = ligne44.plus(ligne45);

  const isCredit = ligneB2.minus(ligneB1).isPositive();
  const ligneB3 = isCredit ? ligneB2.minus(ligneB1) : null;
  const ligne48 = isCredit ? null : ligneB1.minus(ligneB2);
  const ligne60 = ligne48 ?? Money.zero();

  return {
    periodStart,
    periodEnd,
    collecteeByRate: IMPLEMENTED_RATES.map((rate) => {
      const bucket = buckets.get(rate.label)!;
      return {
        ligne: rate.ligne,
        label: rate.label,
        ratePercent: rate.ratePercent.toApiString(),
        baseHT: roundToNearestEuro(bucket.baseHT).toApiString(),
        taxe: roundToNearestEuro(bucket.taxe).toApiString(),
      };
    }),
    ligneB1: roundToNearestEuro(ligneB1).toApiString(),
    ligne44: roundToNearestEuro(ligne44).toApiString(),
    ligne45: roundToNearestEuro(ligne45).toApiString(),
    ligneB2: roundToNearestEuro(ligneB2).toApiString(),
    ligneB3: ligneB3 ? roundToNearestEuro(ligneB3).toApiString() : null,
    ligne48: ligne48 ? roundToNearestEuro(ligne48).toApiString() : null,
    ligne60: roundToNearestEuro(ligne60).toApiString(),
  };
}
