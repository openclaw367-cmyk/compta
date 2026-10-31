import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { CDR_RULES } from '../liasse/compte-resultat-2052-2053';
import { traceLine } from '../liasse/liasse-line-trace';
import { TrialBalanceAccount } from '../liasse/trial-balance-engine';
import { CashFlowFormulaCode, CashFlowFormulaTerm } from '../cash-flow/cash-flow-trace';

/**
 * Traceability drill-down, Tier 4 — "formula trace" for the retraitement
 * analytique's SIG cascade. See CLAUDE.md "Traceability drill-down (Tier
 * 4)" and `cash-flow-trace.ts`'s own doc comment for the shared
 * discipline (a formula term that's a sum of real `CDR_RULES` codes is
 * independently re-traced via Tier 1's `traceLine()`, never re-derived
 * by reading `CompteResultat2052_2053.lignes` directly — the two layers
 * must be genuinely separate derivations for the oracle to mean
 * anything).
 *
 * **Covered this pass**: `margeCommerciale`, `valeurAjoutee`, `ebe` —
 * the first three soldes of `computeSigCascade()`'s own cascade, each a
 * FLAT linear combination of literal CDR_RULES codes (no derived
 * sub-subtotal needed as an intermediate "opaque" term, unlike CAF's own
 * `resultatNet` — every one of margeCommerciale/valeurAjoutee/ebe's
 * constituent pieces genuinely IS a sum of raw compte-de-résultat
 * codes). The `CashFlowFormulaTerm`/`CashFlowFormulaCode` shapes are
 * reused verbatim from the cash-flow module (not duplicated) — both
 * modules' formula traces share the exact same "terms, each optionally
 * decomposing into signed CDR codes" shape, so the frontend renders both
 * through the one shared `FormulaTraceDrilldown` component.
 *
 * **Deliberately refused this pass, not attempted**: every solde AFTER
 * `ebe` in the cascade (résultat d'exploitation onward) mixes in GA–GD/
 * G1/GE (dotations, VNC cédée, autres charges) PLUS the already-flagged
 * CESSION codes — tracing those adds no new technique beyond what
 * `margeCommerciale`/`valeurAjoutee`/`ebe` already demonstrate, so
 * extending this list further is a mechanical follow-up, not a new
 * design question, and was left out to keep this pass a deliberate,
 * bounded increment rather than an exhaustive one. BFR/FR/trésorerie/
 * endettement/ratios are all either already covered by
 * `cash-flow-trace.ts` (BFR reuses the SAME accounts) or are RATIOS
 * (dimensionless, not a ledger aggregation to trace at all).
 */

export type FinancialAnalysisFormulaKey = 'margeCommerciale' | 'valeurAjoutee' | 'ebe';

interface SignedCode {
  code: string;
  sign: 1 | -1;
}

interface FormulaConfig {
  key: FinancialAnalysisFormulaKey;
  label: string;
  /** One term per named building block of the SIG cascade's own formula — see computeSigCascade(). */
  terms: { key: string; label: string; sign: 1 | -1; codes: SignedCode[] }[];
}

const MARGE_COMMERCIALE_CODES: SignedCode[] = [
  { code: 'FC', sign: 1 },
  { code: 'FS', sign: -1 },
  { code: 'FT', sign: -1 },
];
const PRODUCTION_DE_L_EXERCICE_CODES: SignedCode[] = [
  { code: 'FF', sign: 1 },
  { code: 'FI', sign: 1 },
  { code: 'FM', sign: 1 },
  { code: 'FN', sign: 1 },
];
const CONSOMMATIONS_EN_PROVENANCE_DES_TIERS_CODES: SignedCode[] = [
  { code: 'FU', sign: 1 },
  { code: 'FV', sign: 1 },
  { code: 'FW', sign: 1 },
];
const AUTRES_CHARGES_EXPLOITATION_COURANTE_CODES: SignedCode[] = [
  { code: 'FO', sign: 1 },
  { code: 'FX', sign: -1 },
  { code: 'FY', sign: -1 },
  { code: 'FZ', sign: -1 },
];

const FORMULA_CONFIGS: FormulaConfig[] = [
  {
    key: 'margeCommerciale',
    label: 'Marge commerciale',
    terms: [
      {
        key: 'margeCommerciale',
        label: 'Marge commerciale',
        sign: 1,
        codes: MARGE_COMMERCIALE_CODES,
      },
    ],
  },
  {
    key: 'valeurAjoutee',
    label: 'Valeur ajoutée',
    terms: [
      {
        key: 'margeCommerciale',
        label: 'Marge commerciale',
        sign: 1,
        codes: MARGE_COMMERCIALE_CODES,
      },
      {
        key: 'productionDeLExercice',
        label: "Production de l'exercice",
        sign: 1,
        codes: PRODUCTION_DE_L_EXERCICE_CODES,
      },
      {
        key: 'consommationsEnProvenanceDesTiers',
        label: 'Consommations en provenance des tiers',
        sign: -1,
        codes: CONSOMMATIONS_EN_PROVENANCE_DES_TIERS_CODES,
      },
    ],
  },
  {
    key: 'ebe',
    label: "Excédent brut d'exploitation (EBE)",
    terms: [
      {
        key: 'margeCommerciale',
        label: 'Marge commerciale',
        sign: 1,
        codes: MARGE_COMMERCIALE_CODES,
      },
      {
        key: 'productionDeLExercice',
        label: "Production de l'exercice",
        sign: 1,
        codes: PRODUCTION_DE_L_EXERCICE_CODES,
      },
      {
        key: 'consommationsEnProvenanceDesTiers',
        label: 'Consommations en provenance des tiers',
        sign: -1,
        codes: CONSOMMATIONS_EN_PROVENANCE_DES_TIERS_CODES,
      },
      {
        key: 'autresChargesExploitationCourante',
        label: 'Subventions, impôts/taxes, salaires et cotisations sociales (FO−FX−FY−FZ)',
        sign: 1,
        codes: AUTRES_CHARGES_EXPLOITATION_COURANTE_CODES,
      },
    ],
  },
];

export function financialAnalysisFormulaConfig(key: string): FormulaConfig | undefined {
  return FORMULA_CONFIGS.find((c) => c.key === key);
}

export interface FinancialAnalysisFormulaTraceResult {
  key: FinancialAnalysisFormulaKey;
  label: string;
  officialValue: string;
  terms: CashFlowFormulaTerm[];
}

function sumSignedCodes(
  accounts: TrialBalanceAccount[],
  codes: SignedCode[],
): { total: Money; entries: CashFlowFormulaCode[] } {
  const entries: CashFlowFormulaCode[] = codes.map(({ code, sign }) => {
    const traced = traceLine(code, accounts, CDR_RULES);
    return { code, label: traced.lineLabel, sign, value: traced.lineValue };
  });
  const total = entries.reduce(
    (sum, e) => sum.plus(Money.fromString(e.value).times(e.sign)),
    Money.zero(),
  );
  return { total, entries };
}

/**
 * Pure computation, no I/O. `cdrAccounts` must be the SAME closing
 * compte-de-résultat trial balance (pcgClass 6–7) the SIG cascade's own
 * `computeSigCascade()` reads from `CompteResultat2052_2053.lignes` —
 * this function re-derives each term from the RAW accounts via Tier 1's
 * `traceLine()` instead, a genuinely separate code path. `officialValue`
 * must be the already-computed `SigCascade`'s own value for this `key`.
 * Throws `BadRequestException` for an unknown key, `ConflictException`
 * (the oracle) if the independently re-derived total doesn't equal
 * `officialValue` to the centime.
 */
export function traceFinancialAnalysisFormula(
  key: string,
  cdrAccounts: TrialBalanceAccount[],
  officialValue: Money,
): FinancialAnalysisFormulaTraceResult {
  const config = financialAnalysisFormulaConfig(key);
  if (!config) {
    throw new BadRequestException(
      `"${key}" n'est pas une formule de l'analyse financière traçable par ce module — voir ` +
        'CLAUDE.md "Traceability drill-down (Tier 4)" pour la liste des soldes couverts.',
    );
  }

  const terms: CashFlowFormulaTerm[] = config.terms.map((term) => {
    const { total, entries } = sumSignedCodes(cdrAccounts, term.codes);
    return {
      key: term.key,
      label: term.label,
      sign: term.sign,
      value: total.toApiString(),
      codes: entries,
    };
  });

  const recomputed = terms.reduce(
    (sum, term) => sum.plus(Money.fromString(term.value).times(term.sign)),
    Money.zero(),
  );

  if (!recomputed.equals(officialValue)) {
    throw new ConflictException(
      `Traçabilité rompue pour ${key} : le détail retracé (${recomputed.toApiString()}) ne ` +
        `correspond pas à la valeur déjà affichée (${officialValue.toApiString()}) — la décomposition ` +
        'de cette formule doit être corrigée avant de pouvoir faire confiance à ce détail.',
    );
  }

  return {
    key: config.key,
    label: config.label,
    officialValue: officialValue.toApiString(),
    terms,
  };
}
