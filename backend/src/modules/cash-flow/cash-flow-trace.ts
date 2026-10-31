import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import {
  ACTIF_RULES as BILAN_ACTIF_RULES,
  PASSIF_RULES as BILAN_PASSIF_RULES,
  DUAL_NATURE_RULES as BILAN_DUAL_NATURE_RULES,
} from '../liasse/bilan-2050';
import { CDR_RULES } from '../liasse/compte-resultat-2052-2053';
import { CESSION_CHARGE_CODES, CESSION_PRODUIT_CODES } from '../liasse/liasse-articulation';
import { traceLine } from '../liasse/liasse-line-trace';
import { TrialBalanceAccount } from '../liasse/trial-balance-engine';

/**
 * Traceability drill-down, Tier 4 — "formula trace" for the tableau des
 * flux de trésorerie. See CLAUDE.md "Traceability drill-down (Tier 4)"
 * and specs/roadmap.md's own framing: unlike Tiers 1–3 (a report line
 * that's a straight aggregation of ledger accounts, reverse-mapped via
 * `resolveLineContribution()`), most cash-flow/financial-analysis lines
 * are either a FORMULA over several already-computed figures or a DELTA
 * between two bilan snapshots — there is no single "list of underlying
 * écritures" to reverse-map directly. This module covers a deliberately
 * bounded first increment, not every line in cash-flow-statement.ts:
 *
 * - **capacité d'autofinancement (CAF)** decomposes into its own
 *   documented formula terms (see cash-flow-statement.ts's own doc
 *   comment) — `resultatNet` is a genuine non-drillable derived subtotal
 *   (HN, the compte de résultat's own bottom line — the SAME category as
 *   bilan's own DI, which Tier 1's `traceLine()` already refuses to
 *   decompose), every OTHER term is a sum of real `CDR_RULES` codes,
 *   each independently re-traced via Tier 1's own `traceLine()` — reused
 *   verbatim, never re-derived, so this module can never silently drift
 *   from Tier 1's own per-account classification logic.
 * - **Six "clean bilan-line delta" flux lines** — each a Δ(closing bilan
 *   line(s), opening bilan line(s)) where "bilan line(s)" means one or
 *   more literal `ACTIF_RULES`/`PASSIF_RULES` codes with no dual-nature
 *   commingling beyond what Tier 1 already resolves correctly (BX,
 *   stocks, DX+DY, DZ, emprunts, capital). Each side is independently
 *   traced via the SAME `traceLine()` primitive, just fed a different
 *   account list (the opening, à-nouveau-only subset vs. the full-year
 *   closing subset) — see `CashFlowService.buildContext()`'s own
 *   `openingBilanAccounts`/`closingBilanAccounts`.
 *
 * **Deliberately refused this pass, not attempted** (see CLAUDE.md for
 * the full reasoning per line):
 * - `variationTvaDeductibleAutres`/`variationTvaDeductibleImmobilisations`/
 *   `variationCreancesSurCessions`/`variationComptesCourantsAssocies` —
 *   each is a Δ of a RAW account balance (445660/445662/462/455)
 *   carved out of the bilan's own genuinely-commingled BZ/EA lines —
 *   there is no "bilan line" for Tier 1's engine to reverse-map against,
 *   only a single already-identified account, so there's nothing a
 *   formula/delta trace would usefully add beyond "it's exactly this one
 *   account's own balance" (the dedicated 2059-A/cession-style "one
 *   account, no further structure" case this app already handles by
 *   simply not building a trace for it).
 * - `acquisitionsImmobilisations`/`cessionsImmobilisations` — asset-level
 *   `FixedAsset` sums, not ledger-line aggregations at all. These are
 *   ALREADY traceable, in more useful per-asset detail, via the existing
 *   Tier 2 2054 "acquisitions"/"cessions" columns and the Tier 3 2059-A
 *   trace — a new Tier 4 trace here would only duplicate those, worse.
 * - `distributions` — always "0.00" (no affectation-du-résultat
 *   mechanism exists anywhere in this app, see cash-flow-statement.ts) —
 *   nothing to trace.
 * - `tresorerieOuverture`/`tresorerieCloture`/`variationTresorerie` (the
 *   top-level reconciliation figures) — already the subject of
 *   `ReconciliationBanner` on `CashFlowPage`; adding a drill-down here
 *   would just restate the same three flux totals this module already
 *   covers piecemeal.
 */

// ---------------------------------------------------------------------------
// Capacité d'autofinancement (CAF)
// ---------------------------------------------------------------------------

export interface CashFlowFormulaCode {
  code: string;
  label: string;
  /** Sign this code carries INSIDE its own term's subtotal — independent of the term's own sign below. */
  sign: 1 | -1;
  /** This code's own unsigned value, as traced via Tier 1's traceLine(). */
  value: string;
}

export interface CashFlowFormulaTerm {
  key: string;
  label: string;
  /** Sign this term carries when combined into the parent formula's total. */
  sign: 1 | -1;
  /** This term's own subtotal (sum of its own codes' signed values), or — for a non-decomposable term — its raw value. */
  value: string;
  /** Present when this term further decomposes into CDR_RULES codes — reuse Tier 1's /liasse/cdr-line-trace per code to go further. Absent for a non-decomposable (opaque) term. */
  codes?: CashFlowFormulaCode[];
  /** Present only when `codes` is absent — states honestly why this term stops here. */
  nonTraceableReason?: string;
}

export interface CashFlowFormulaTraceResult {
  key: 'capaciteAutofinancement';
  label: string;
  officialValue: string;
  terms: CashFlowFormulaTerm[];
}

function sumCdrCodes(
  accounts: TrialBalanceAccount[],
  codes: string[],
): { total: Money; entries: CashFlowFormulaCode[] } {
  const entries: CashFlowFormulaCode[] = codes.map((code) => {
    const traced = traceLine(code, accounts, CDR_RULES);
    return { code, label: traced.lineLabel, sign: 1 as const, value: traced.lineValue };
  });
  const total = entries.reduce((sum, e) => sum.plus(Money.fromString(e.value)), Money.zero());
  return { total, entries };
}

/**
 * Pure computation, no I/O. `cdrAccounts` must be the SAME closing
 * compte-de-résultat trial balance (pcgClass 6–7) `CashFlowService`
 * already builds for the forward computation; `resultatNet`/
 * `officialCaf` must be the SAME statement's own `fluxExploitation`
 * figures. Throws (`ConflictException`) if this module's own
 * independent re-derivation (via `traceLine()` on raw accounts) doesn't
 * equal the already-computed CAF to the centime — the oracle, exactly
 * like Tier 1's `assertLineTraceabilitySums()`.
 */
export function traceCashFlowCaf(
  cdrAccounts: TrialBalanceAccount[],
  resultatNet: Money,
  officialCaf: Money,
): CashFlowFormulaTraceResult {
  const dotations = sumCdrCodes(cdrAccounts, ['GA', 'GB', 'GC', 'GD', 'GQ']);
  const reprises = sumCdrCodes(cdrAccounts, ['FP', 'GM']);
  const valeurComptable = sumCdrCodes(cdrAccounts, CESSION_CHARGE_CODES);
  const produitsCessions = sumCdrCodes(cdrAccounts, CESSION_PRODUIT_CODES);

  const recomputedCaf = resultatNet
    .plus(dotations.total)
    .plus(valeurComptable.total)
    .minus(reprises.total)
    .minus(produitsCessions.total);

  if (!recomputedCaf.equals(officialCaf)) {
    throw new ConflictException(
      `Traçabilité rompue pour la CAF : le détail retracé (${recomputedCaf.toApiString()}) ne ` +
        `correspond pas à la CAF déjà affichée (${officialCaf.toApiString()}) — la décomposition de ` +
        'cette formule doit être corrigée avant de pouvoir faire confiance à ce détail.',
    );
  }

  const terms: CashFlowFormulaTerm[] = [
    {
      key: 'resultatNet',
      label: 'Résultat net',
      sign: 1,
      value: resultatNet.toApiString(),
      nonTraceableReason:
        "Le résultat net (HN) n'est pas lui-même une ligne codée du compte de résultat — c'est un " +
        'sous-total dérivé (total des produits − total des charges), au même titre que DI au bilan ' +
        "(voir Tier 1). Non décomposable davantage par ce module ; c'est le fond honnête de cette " +
        'branche-ci de la formule.',
    },
    {
      key: 'dotationsAmortissementsProvisions',
      label: 'Dotations amortissements et provisions (GA+GB+GC+GD+GQ)',
      sign: 1,
      value: dotations.total.toApiString(),
      codes: dotations.entries,
    },
    {
      key: 'valeurComptableElementsCedes',
      label: `Valeur comptable des éléments cédés (${CESSION_CHARGE_CODES.join('+')})`,
      sign: 1,
      value: valeurComptable.total.toApiString(),
      codes: valeurComptable.entries,
    },
    {
      key: 'reprisesAmortissementsProvisions',
      label: 'Reprises sur amortissements et provisions (FP+GM)',
      sign: -1,
      value: reprises.total.toApiString(),
      codes: reprises.entries,
    },
    {
      key: 'produitsDesCessions',
      label: `Produits des cessions d'éléments d'actif (${CESSION_PRODUIT_CODES.join('+')})`,
      sign: -1,
      value: produitsCessions.total.toApiString(),
      codes: produitsCessions.entries,
    },
  ];

  return {
    key: 'capaciteAutofinancement',
    label: "Capacité d'autofinancement (CAF)",
    officialValue: officialCaf.toApiString(),
    terms,
  };
}

// ---------------------------------------------------------------------------
// "Clean bilan-line delta" flux lines — BFR movement + financing lines
// that are each exactly one or more literal bilan-2050 codes, with no
// raw-account carve-out involved (see module doc comment above for which
// lines were excluded from this list and why).
// ---------------------------------------------------------------------------

export type CashFlowDeltaLineKey =
  | 'variationCreancesClients'
  | 'variationStocks'
  | 'variationDettesExploitation'
  | 'variationDettesSurImmobilisations'
  | 'variationEmprunts'
  | 'variationCapital';

interface DeltaLineConfig {
  key: CashFlowDeltaLineKey;
  label: string;
  codes: string[];
}

/** Codes copied verbatim from cash-flow-statement.ts's own constants — see that module for the citation. */
const DELTA_LINE_CONFIGS: DeltaLineConfig[] = [
  {
    key: 'variationCreancesClients',
    label: 'Variation des créances clients (brut)',
    codes: ['BX'],
  },
  {
    key: 'variationStocks',
    label: 'Variation des stocks (brut)',
    codes: ['BL', 'BN', 'BP', 'BR', 'BT'],
  },
  {
    key: 'variationDettesExploitation',
    label: "Variation des dettes d'exploitation",
    codes: ['DX', 'DY'],
  },
  {
    key: 'variationDettesSurImmobilisations',
    label: 'Variation des dettes sur immobilisations',
    codes: ['DZ'],
  },
  { key: 'variationEmprunts', label: 'Variation des emprunts', codes: ['DS', 'DT', 'DU', 'DV'] },
  { key: 'variationCapital', label: 'Variation du capital', codes: ['DA'] },
];

export function cashFlowDeltaLineConfig(key: string): DeltaLineConfig | undefined {
  return DELTA_LINE_CONFIGS.find((c) => c.key === key);
}

export interface CashFlowDeltaLineCode {
  code: string;
  label: string;
  value: string;
}

export interface CashFlowDeltaLineSide {
  totalValue: string;
  codes: CashFlowDeltaLineCode[];
}

export interface CashFlowDeltaLineTraceResult {
  key: CashFlowDeltaLineKey;
  label: string;
  /** closing.totalValue − opening.totalValue. */
  officialValue: string;
  opening: CashFlowDeltaLineSide;
  closing: CashFlowDeltaLineSide;
}

function traceCodesAgainst(
  accounts: TrialBalanceAccount[],
  codes: string[],
): { total: Money; entries: CashFlowDeltaLineCode[] } {
  const entries: CashFlowDeltaLineCode[] = codes.map((code) => {
    const traced = traceLine(
      code,
      accounts,
      [...BILAN_ACTIF_RULES, ...BILAN_PASSIF_RULES],
      BILAN_DUAL_NATURE_RULES,
    );
    return { code, label: traced.lineLabel, value: traced.lineValue };
  });
  const total = entries.reduce((sum, e) => sum.plus(Money.fromString(e.value)), Money.zero());
  return { total, entries };
}

/**
 * Pure computation, no I/O. `openingAccounts`/`closingAccounts` must be
 * the SAME `openingBilanAccounts`/`closingBilanAccounts` lists
 * `CashFlowService.buildContext()` already builds — not a new query.
 * `officialValue` must be the already-computed `CashFlowStatement`'s own
 * line value for this `key`. Throws `BadRequestException` for an unknown
 * key, `ConflictException` (the oracle) if the independently re-derived
 * delta doesn't equal `officialValue` to the centime.
 */
export function traceCashFlowDeltaLine(
  key: string,
  openingAccounts: TrialBalanceAccount[],
  closingAccounts: TrialBalanceAccount[],
  officialValue: Money,
): CashFlowDeltaLineTraceResult {
  const config = cashFlowDeltaLineConfig(key);
  if (!config) {
    throw new BadRequestException(
      `"${key}" n'est pas une ligne du tableau de flux traçable par ce module — voir CLAUDE.md ` +
        '"Traceability drill-down (Tier 4)" pour la liste des lignes couvertes et celles ' +
        'explicitement refusées.',
    );
  }

  const opening = traceCodesAgainst(openingAccounts, config.codes);
  const closing = traceCodesAgainst(closingAccounts, config.codes);
  const delta = closing.total.minus(opening.total);

  if (!delta.equals(officialValue)) {
    throw new ConflictException(
      `Traçabilité rompue pour ${key} : le delta retracé (clôture ${closing.total.toApiString()} − ` +
        `ouverture ${opening.total.toApiString()} = ${delta.toApiString()}) ne correspond pas à la ` +
        `valeur déjà affichée dans le tableau de flux (${officialValue.toApiString()}).`,
    );
  }

  return {
    key: config.key,
    label: config.label,
    officialValue: officialValue.toApiString(),
    opening: { totalValue: opening.total.toApiString(), codes: opening.entries },
    closing: { totalValue: closing.total.toApiString(), codes: closing.entries },
  };
}

// ---------------------------------------------------------------------------
// Opening (à-nouveau) side, one level further — the CLOSING side of every
// delta line above reuses the EXISTING /liasse/bilan-line-trace endpoint
// directly from the frontend (same fiscalYearId, same code, regime
// REEL_NORMAL — cash-flow-statement.ts's own bilan is always computed via
// the 2050-series engine regardless of Company.regime, a pre-existing
// fact this module doesn't change). The OPENING side has no equivalent
// existing endpoint (Tier 1's bilan trace only ever sees the full year's
// ledger), so this is the one genuinely new "→ accounts" hop Tier 4 adds.
// ---------------------------------------------------------------------------

export interface CashFlowOpeningAccountTrace {
  accountNumber: string;
  contribution: string;
}

export interface CashFlowOpeningLineTraceResult {
  lineCode: string;
  lineLabel: string;
  lineValue: string;
  accounts: CashFlowOpeningAccountTrace[];
}

/** Account-id-enriched version of `CashFlowOpeningLineTraceResult`, returned by `CashFlowService.traceOpeningBilanLine()` — ids are resolved there (the one place this trace touches Prisma), never by this pure module. */
export interface CashFlowOpeningAccountTraceWithId {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  contribution: string;
}

export interface CashFlowOpeningLineTraceResponse {
  lineCode: string;
  lineLabel: string;
  lineValue: string;
  fiscalYearId: string;
  /** ISO date (YYYY-MM-DD) — the à-nouveau écriture's own date, to scope AccountLedgerDrilldown's periodStart/periodEnd to exactly the opening line. */
  openingDate: string;
  accounts: CashFlowOpeningAccountTraceWithId[];
}

/**
 * Pure computation, no I/O — a thin wrapper reusing Tier 1's own
 * `traceLine()` verbatim, just fed the opening (à-nouveau-only) account
 * list instead of the full year's. `traceLine()`'s own internal oracle
 * (`assertLineTraceabilitySums`) already guarantees the returned accounts
 * sum to `lineValue` — no second check needed here.
 */
export function traceCashFlowOpeningBilanLine(
  lineCode: string,
  openingAccounts: TrialBalanceAccount[],
): CashFlowOpeningLineTraceResult {
  const traced = traceLine(
    lineCode,
    openingAccounts,
    [...BILAN_ACTIF_RULES, ...BILAN_PASSIF_RULES],
    BILAN_DUAL_NATURE_RULES,
  );
  return {
    lineCode: traced.lineCode,
    lineLabel: traced.lineLabel,
    lineValue: traced.lineValue,
    accounts: traced.accounts.map((a) => ({
      accountNumber: a.accountNumber,
      contribution: a.contribution,
    })),
  };
}
