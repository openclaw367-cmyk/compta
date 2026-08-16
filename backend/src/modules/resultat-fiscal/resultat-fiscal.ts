import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { CompteResultat2052_2053 } from '../liasse/compte-resultat-2052-2053';

/**
 * Détermination du résultat fiscal (2058-A-SD / 2058-B-SD cadre III) —
 * fundamentally different from every other liasse module in this app.
 * Every prior module (bilan, compte de résultat, cash-flow, financial
 * analysis) is a pure aggregation of ledger balances with a provable
 * articulation invariant (Actif=Passif, ΔBFR ties to the flux
 * statement, etc.). The résultat fiscal is a comptable→fiscal
 * RECONCILIATION made of réintégrations/déductions that are TAX
 * JUDGMENT, not ledger aggregation — there is no oracle that proves a
 * given résultat fiscal correct, because correctness depends on which
 * adjustments actually apply under tax law, something this module
 * cannot see from the ledger. See CLAUDE.md "Résultat fiscal — 2058-A/
 * 2058-B" for the full three-bucket design this implements (computed,
 * rule-based, user-declared) and the notice (2032-NOT-SD) citations
 * behind each bucket assignment.
 *
 * Scope decisions, all deliberate:
 * - **`resultatComptable` is a single SIGNED value** (from
 *   `CompteResultat2052_2053.beneficeOuPerte` directly), not the form's
 *   own two-line WA (bénéfice)/WS (perte) split. The split is a pure
 *   CERFA presentation convention (positive→one line, negative→the
 *   other) with no computational content beyond the sign — reproducing
 *   it is a display-layer concern for whenever the CERFA-shaped UI is
 *   built, not a computation this module needs to model.
 * - **`I7` (impôt sur les sociétés) is COMPUTED, not declared** — it's
 *   simply `CompteResultat2052_2053`'s own `HK` line (account 695,
 *   already a clean, dedicated CDR line with no ambiguity), confirmed
 *   by the notice: "le montant sera reporté ligne I7 du tableau
 *   n°2058-A-SD". No new ledger query needed.
 * - **`WJ` (amendes et pénalités, account 6712) and `WG` (taxe sur les
 *   véhicules des sociétés, account 63514) are SUGGESTED, not
 *   auto-locked.** Both accounts are confirmed as individually
 *   addressable in the PCG (Reglt 2014-03: 6712 "Pénalités, amendes
 *   fiscales et pénales", distinct from 6711/6717/678; 63514 "Taxe sur
 *   les véhicules des sociétés", distinct from the rest of 635/637) —
 *   but a réintégration is a judgment about what belongs, not a
 *   balance-sheet definition, so a fine mis-posted to 6788 instead of
 *   6712 would silently understate the tax base if this were
 *   auto-populated and trusted blindly. The compute function surfaces
 *   BOTH the ledger-derived suggestion and whatever the caller actually
 *   confirms (which may equal, exceed, or fall short of the
 *   suggestion) — never silently substitutes one for the other.
 * - **`XE` (=WD+WE+WF+WG+RA) and `XW` (=WI+WJ+XX+XZ) are real,
 *   notice-confirmed pure-sum columns** ("Mentionner dans la case XE/
 *   XW, la somme des montants mentionnés dans les cases...") but are
 *   NOT modeled as separate fields here — summing the flat list of
 *   individual réintégration lines directly produces the exact same
 *   TOTAL I the CERFA's own two-step (sum into XE/XW, then sum those
 *   into WR) would, since XE/XW add no logic beyond addition. A pure
 *   CERFA print-layout grouping, deferred to whenever the CERFA-shaped
 *   UI is built, same reasoning as the WA/WS split above.
 * - **Every other réintégration/déduction is USER-DECLARED** — a flat
 *   list of `{ code, label, montant }`, one entry per adjustment the
 *   user enters, each citing its own 2058-A/B line code so the
 *   worksheet stays traceable to the form even though the amounts
 *   aren't derived. No line is guessed into a category by this module.
 * - **`totalReintegrations`/`totalDeductions`/`resultatFiscal` are the
 *   ONE real, assertable tie-out this module has** — pure arithmetic
 *   over whatever the constituent lines resolve to, regardless of
 *   whether each line came from the computed anchor, a confirmed
 *   suggestion, or a user-declared entry. This is NOT a completeness
 *   guarantee: the worksheet can be arithmetically perfect while still
 *   omitting a réintégration the user never declared. Callers (and
 *   eventually the UI) must not present a successful response here as
 *   proof of tax correctness — see CLAUDE.md for the required UI
 *   copy on this point.
 */

const PENALITES_AMENDES_ACCOUNT_PREFIX = '6712';
const TAXE_VEHICULES_ACCOUNT_PREFIX = '63514';

export interface ResultatFiscalLigne {
  code: string;
  label: string;
  montant: string;
}

/** A réintégration the ledger can suggest, but which the caller must confirm (or override) before it counts toward the total. */
export interface ConfirmableLigne {
  code: string;
  label: string;
  /** Ledger-derived suggestion (e.g. Σ compte 6712) — informational, never silently used on its own. */
  suggested: string;
  /** What actually feeds totalReintegrations/totalDeductions — equals `suggested` only if the caller confirmed it as-is. */
  confirmed: string;
}

export interface ResultatFiscalInput {
  closingCompteResultat: CompteResultat2052_2053;
  /** Ledger-derived suggestion for WJ (Σ compte 6712) — see module doc comment. */
  suggestedAmendesEtPenalites: Money;
  /** What the caller confirmed for WJ — may equal, exceed, or fall short of the suggestion. */
  confirmedAmendesEtPenalites: Money;
  /** Ledger-derived suggestion for WG (Σ compte 63514). */
  suggestedTaxeVehicules: Money;
  /** What the caller confirmed for WG. */
  confirmedTaxeVehicules: Money;
  /** Every other réintégration the user declares — free-form, any 2058-A code (WD, WE, WF, XX, XD, ...). */
  reintegrationsDeclarees: ResultatFiscalLigne[];
  /** Every déduction the user declares — free-form, any 2058-A/2058-B code. */
  deductionsDeclarees: ResultatFiscalLigne[];
}

export interface ResultatFiscalResult {
  /** = CompteResultat2052_2053.beneficeOuPerte, signed. See module doc comment for why WA/WS aren't split here. */
  resultatComptable: string;
  /** I7 — computed from HK (compte 695), not declared. */
  impotSurLesSocietes: ResultatFiscalLigne;
  /** WJ, WG — suggested from the ledger, confirmed by the caller. */
  reintegrationsConfirmables: ConfirmableLigne[];
  /** Every other réintégration, as declared. */
  reintegrationsDeclarees: ResultatFiscalLigne[];
  /** WR — I7 + Σ confirmed réintégrations + Σ declared réintégrations. */
  totalReintegrations: string;
  /** Every déduction, as declared. */
  deductionsDeclarees: ResultatFiscalLigne[];
  /** XH — Σ declared déductions. */
  totalDeductions: string;
  /** XN (bénéfice) or XO (déficit) — resultatComptable + totalReintegrations − totalDeductions. Signed: negative means déficit. */
  resultatFiscal: string;
}

function cdrMontant(cdr: CompteResultat2052_2053, code: string): Money {
  const ligne = cdr.lignes.find((l) => l.code === code);
  return ligne ? Money.fromString(ligne.montant) : Money.zero();
}

function sumLignes(lignes: ResultatFiscalLigne[]): Money {
  return lignes.reduce((sum, l) => sum.plus(Money.fromString(l.montant)), Money.zero());
}

/**
 * Reads the raw account balances behind WJ/WG's suggestions — exported so
 * the service layer can compute them from the same trial balance it
 * already has, the same "sum a raw account by prefix" pattern
 * cash-flow.service.ts already established for 462/445660/445662.
 */
export const CONFIRMABLE_LINE_ACCOUNT_PREFIXES = {
  WJ: PENALITES_AMENDES_ACCOUNT_PREFIX,
  WG: TAXE_VEHICULES_ACCOUNT_PREFIX,
} as const;

/** Pure computation, no I/O. */
export function computeResultatFiscal(input: ResultatFiscalInput): ResultatFiscalResult {
  const resultatComptable = Money.fromString(input.closingCompteResultat.beneficeOuPerte);
  const impotSurLesSocietesMontant = cdrMontant(input.closingCompteResultat, 'HK');
  const impotSurLesSocietes: ResultatFiscalLigne = {
    code: 'I7',
    label: 'Impôt sur les sociétés',
    montant: impotSurLesSocietesMontant.toApiString(),
  };

  const reintegrationsConfirmables: ConfirmableLigne[] = [
    {
      code: 'WJ',
      label: 'Amendes et pénalités',
      suggested: input.suggestedAmendesEtPenalites.toApiString(),
      confirmed: input.confirmedAmendesEtPenalites.toApiString(),
    },
    {
      code: 'WG',
      label: 'Taxe sur les véhicules des sociétés',
      suggested: input.suggestedTaxeVehicules.toApiString(),
      confirmed: input.confirmedTaxeVehicules.toApiString(),
    },
  ];

  const totalConfirmables = reintegrationsConfirmables.reduce(
    (sum, l) => sum.plus(Money.fromString(l.confirmed)),
    Money.zero(),
  );
  const totalReintegrationsDeclarees = sumLignes(input.reintegrationsDeclarees);
  const totalReintegrations = impotSurLesSocietesMontant
    .plus(totalConfirmables)
    .plus(totalReintegrationsDeclarees);

  const totalDeductions = sumLignes(input.deductionsDeclarees);

  const resultatFiscal = resultatComptable.plus(totalReintegrations).minus(totalDeductions);

  return {
    resultatComptable: resultatComptable.toApiString(),
    impotSurLesSocietes,
    reintegrationsConfirmables,
    reintegrationsDeclarees: input.reintegrationsDeclarees,
    totalReintegrations: totalReintegrations.toApiString(),
    deductionsDeclarees: input.deductionsDeclarees,
    totalDeductions: totalDeductions.toApiString(),
    resultatFiscal: resultatFiscal.toApiString(),
  };
}

/**
 * The one real tie-out this module has: totalReintegrations/
 * totalDeductions/resultatFiscal must equal the mechanical sum of their
 * own constituent lines — asserted independently (re-summed a second
 * time here) rather than trusted from computeResultatFiscal's own
 * construction, same "re-derive and compare" discipline as
 * assertTableau2057TiesToBilan. This catches a future edit that changes
 * one of the sums without updating the other, never tax completeness
 * (which this module cannot verify — see module doc comment).
 */
export function assertResultatFiscalArithmetic(result: ResultatFiscalResult): void {
  const expectedTotalReintegrations = Money.fromString(result.impotSurLesSocietes.montant)
    .plus(
      result.reintegrationsConfirmables.reduce(
        (sum, l) => sum.plus(Money.fromString(l.confirmed)),
        Money.zero(),
      ),
    )
    .plus(sumLignes(result.reintegrationsDeclarees));
  if (!expectedTotalReintegrations.equals(Money.fromString(result.totalReintegrations))) {
    throw new ConflictException(
      `Le total des réintégrations (${result.totalReintegrations}) ne correspond pas à la somme de ` +
        `ses propres lignes (${expectedTotalReintegrations.toApiString()}). Ceci est un bug de ` +
        'calcul, jamais une question de complétude fiscale.',
    );
  }

  const expectedTotalDeductions = sumLignes(result.deductionsDeclarees);
  if (!expectedTotalDeductions.equals(Money.fromString(result.totalDeductions))) {
    throw new ConflictException(
      `Le total des déductions (${result.totalDeductions}) ne correspond pas à la somme de ses ` +
        `propres lignes (${expectedTotalDeductions.toApiString()}). Ceci est un bug de calcul, ` +
        'jamais une question de complétude fiscale.',
    );
  }

  const expectedResultatFiscal = Money.fromString(result.resultatComptable)
    .plus(Money.fromString(result.totalReintegrations))
    .minus(Money.fromString(result.totalDeductions));
  if (!expectedResultatFiscal.equals(Money.fromString(result.resultatFiscal))) {
    throw new ConflictException(
      `Le résultat fiscal (${result.resultatFiscal}) ne correspond pas à résultat comptable + ` +
        `réintégrations − déductions (${expectedResultatFiscal.toApiString()}). Ceci est un bug de ` +
        'calcul, jamais une question de complétude fiscale.',
    );
  }
}
