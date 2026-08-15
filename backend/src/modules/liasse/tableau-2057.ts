import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import { Bilan2050, ACTIF_RULES, PASSIF_RULES, DUAL_NATURE_RULES } from './bilan-2050';
import { resolveLineCode } from './liasse-line-rules';

/**
 * 2057-SD (État des échéances des créances et des dettes) — see
 * specs/liasse-2056-2059-implementation-spec.md §3 and
 * specs/2050-liasse_5320.pdf page 9 for the rendered form (case codes
 * UL/UM/UN.../VT-VV for Cadre A, 7Y/7Z/VG.../VY-VZ for Cadre B).
 *
 * **MONTANT BRUT** (per nature line): a pure REGROUPING of the
 * already-computed Bilan2050 — every 2057 row is exactly one bilan
 * actif/passif line, relabeled. Rather than re-classifying raw ledger
 * accounts a third time (bilan-2050.ts already does this once), this
 * reuses that result directly. Some 2057 lines the form prints
 * separately (clients douteux vs. autres créances clients; personnel /
 * sécurité sociale / impôts sur les bénéfices / TVA / autres impôts) are
 * NOT separable from the current chart, because bilan-2050.ts already
 * merges them into one line each (BX, DY) — not a mapping problem the
 * account numbers can solve. Every row states the bilan line it
 * reproduces. The form's origin-based split on "Emprunts et dettes
 * auprès des établissements de crédit" (à 1 an maximum / à plus d'1 an
 * À L'ORIGINE — VG/VH) is a SEPARATE, still-unbuilt gap: it needs the
 * loan's original term at inception, which `dateEcheance` (a due date,
 * not an origin term) can't answer either — DU stays one combined row.
 *
 * **À 1 AN AU PLUS / À PLUS D'UN AN (Cadre A) and the three-way split
 * (Cadre B)** — as of 2026-08-15, no longer blocked: `EcritureLigne.
 * dateEcheance` (added this pass) lets a créance/dette line carry a due
 * date. Computed from a SEPARATE pass over raw, dateEcheance-tagged
 * lignes (montantBrut still comes from Bilan2050, unchanged) — the two
 * are independently derived and asserted to tie out per line
 * (`aUnAnAuPlus + aPlusDUnAn === montantBrut`, etc.), the same
 * "two-independently-sourced-numbers" discipline used everywhere else
 * in this app's articulation checks.
 *
 * **The default bucket for a line with no `dateEcheance` is NOT a
 * single blanket choice — it depends on the account's own structural
 * nature, per `LONG_TERM_BY_NATURE_CADRE_A_CODES`/`_CADRE_B_CODES`
 * below.** An earlier version of this function defaulted every
 * undated line to "à un an au plus" uniformly, justified as
 * "conservative" — that justification only actually holds for
 * exploitation-courante créances/dettes (clients, fournisseurs, dettes
 * fiscales et sociales, ...). Applied uniformly, it silently
 * mis-defaulted BB/BF/BH (immobilisations financières — long-term by
 * their own PCG classification, sitting in ACTIF IMMOBILISÉ not ACTIF
 * CIRCULANT on the bilan itself) and DS/DT/DU/DV/DZ (emprunts and
 * dettes sur immobilisations — financing debt, typically repaid over
 * several years, not operating debt) into the short-term bucket —
 * found and fixed live, not by inspection: a real "dettes sur
 * immobilisations" balance defaulting to "à un an au plus" was
 * flagged as implausible. Fixed: these structurally-long-term codes
 * now default to "à plus d'un an" (Cadre A) / "à plus d'1 an et 5 ans
 * au plus" (Cadre B, the least-arbitrary single bucket for undated
 * financing debt — jumping straight to "à plus de 5 ans" would be an
 * equally ungrounded guess in the other direction). Genuinely
 * exploitation-courante codes keep the short-term default, which now
 * actually fits every line it's applied to. Documented, not silent:
 * `maturityNote` states the two-tier convention explicitly.
 *
 * **A reversal (contre-passation) does NOT carry the original line's
 * `dateEcheance` forward** — `EntriesService.reverse()` never copies it
 * (same as `lettrage`/`dateLettrage`). This means the reversal's OWN
 * maturity bucket is resolved from the DEFAULT convention above, not
 * from whatever real date the line it's undoing had. For a validated,
 * dated line that later gets reversed, the original and its reversal
 * cancel out at the TOTAL (montantBrut) level — that tie-out still
 * holds exactly — but may land in DIFFERENT buckets, leaving a
 * temporary-looking (but entirely correct) split-level artifact. Found
 * live while manually testing this feature (see CLAUDE.md "Test
 * fixtures" — the FR demo company's account 404 carries exactly this
 * artifact, kept deliberately rather than posted around).
 */

export interface Tableau2057CadreALigne {
  code: string;
  label: string;
  montantBrut: string;
  /** À 1 an au plus. */
  aUnAnAuPlus: string;
  /** À plus d'un an. */
  aPlusDUnAn: string;
}

export interface Tableau2057CadreBLigne {
  code: string;
  label: string;
  montantBrut: string;
  /** À 1 an au plus. */
  aUnAnAuPlus: string;
  /** À plus d'1 an et 5 ans au plus. */
  aPlusDUnAnEt5AnsAuPlus: string;
  /** À plus de 5 ans. */
  aPlusDe5Ans: string;
}

export interface Tableau2057 {
  cadreA: Tableau2057CadreALigne[];
  /** Sum of Cadre A montants bruts. */
  totalCreances: string;
  cadreB: Tableau2057CadreBLigne[];
  /** Sum of Cadre B montants bruts. */
  totalDettes: string;
  note: string;
  maturityNote: string;
}

/** Raw, dateEcheance-tagged ligne — the maturity split's own input, separate from Bilan2050. */
export interface Tableau2057RawLigne {
  compteNumber: string;
  pcgClass: number;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  dateEcheance: Date | null;
}

/** Cadre A (état des créances) — each row reproduces one Bilan2050.actif line's brut value. */
const CADRE_A_ROWS: { code: string; label: string }[] = [
  { code: 'BB', label: 'Créances rattachées à des participations' },
  { code: 'BF', label: 'Prêts' },
  { code: 'BH', label: 'Autres immobilisations financières' },
  { code: 'BV', label: 'Avances et acomptes versés sur commandes' },
  { code: 'BX', label: 'Clients et comptes rattachés' },
  { code: 'BZ', label: 'Autres créances' },
  { code: 'CH', label: "Charges constatées d'avance" },
];
const CADRE_A_CODES = new Set(CADRE_A_ROWS.map((r) => r.code));

/** Cadre B (état des dettes) — every line in Bilan2050.passif's "Dettes" section, in full (a complete, disjoint partition, so no combining/dropping needed). */
const CADRE_B_ROWS: { code: string; label: string }[] = [
  { code: 'DS', label: 'Emprunts obligataires convertibles' },
  { code: 'DT', label: 'Autres emprunts obligataires' },
  { code: 'DU', label: 'Emprunts et dettes auprès des établissements de crédit' },
  { code: 'DV', label: 'Emprunts et dettes financières divers' },
  { code: 'DW', label: 'Avances et acomptes reçus sur commandes en cours' },
  { code: 'DX', label: 'Dettes fournisseurs et comptes rattachés' },
  { code: 'DY', label: 'Dettes fiscales et sociales' },
  { code: 'DZ', label: 'Dettes sur immobilisations et comptes rattachés' },
  { code: 'EA', label: 'Autres dettes' },
  { code: 'EB', label: "Produits constatés d'avance" },
];
const CADRE_B_CODES = new Set(CADRE_B_ROWS.map((r) => r.code));

/**
 * BB/BF/BH sit in ACTIF IMMOBILISÉ on the bilan itself (bilan-2050.ts's
 * ACTIF_SECTIONS groups them under "Immobilisations financières") —
 * structurally long-term by their own PCG classification, not a new
 * judgment call layered on top. Every other Cadre A code (BV/BX/BZ/CH)
 * sits in ACTIF CIRCULANT and keeps the short-term default.
 */
const LONG_TERM_BY_NATURE_CADRE_A_CODES = new Set(['BB', 'BF', 'BH']);

/**
 * DS/DT/DU/DV (emprunts obligataires/bancaires/financiers divers) and DZ
 * (dettes sur immobilisations) are financing debt — typically repaid
 * over several years, unlike DW/DX/DY/EA/EB's exploitation-courante
 * nature (avances, fournisseurs, fiscal/social, divers, produits
 * constatés d'avance), which keep the short-term default.
 */
const LONG_TERM_BY_NATURE_CADRE_B_CODES = new Set(['DS', 'DT', 'DU', 'DV', 'DZ']);

const NOTE =
  'Montant brut par nature, régime réel normal — voir CLAUDE.md « Liasse fiscale annexes ' +
  '2056/2059 » pour les subdivisions du formulaire non séparables du plan comptable actuel ' +
  '(clients douteux, détail État/organismes sociaux, groupe et associés).';

const MATURITY_NOTE =
  "L'échéance est calculée à partir de dateEcheance sur chaque ligne d'écriture, quand elle est " +
  "renseignée, par rapport à la date de clôture de l'exercice. Une ligne sans dateEcheance suit un " +
  'défaut à DEUX niveaux selon la nature du poste, pas un compartiment unique : les créances/dettes ' +
  "d'exploitation courantes (clients, fournisseurs, dettes fiscales et sociales, avances, produits " +
  "constatés d'avance, ...) sont placées par défaut « à un an au plus » (hypothèse conservatrice) ; " +
  'les postes structurellement long terme par nature — immobilisations financières (créances ' +
  'rattachées à des participations, prêts, autres immobilisations financières) côté créances, ' +
  "emprunts et dettes sur immobilisations côté dettes — sont placés par défaut « à plus d'un an » " +
  "(Cadre A) ou « à plus d'1 an et 5 ans au plus » (Cadre B) plutôt que « à un an au plus », qui ne " +
  'refléterait pas leur nature réelle. Dans tous les cas, une échéance renseignée prime toujours sur ' +
  "le défaut. La répartition par ORIGINE du prêt (à 1 an maximum / à plus d'1 an à l'origine, ligne " +
  '« Emprunts et dettes auprès des établissements de crédit ») reste non renseignée : dateEcheance ' +
  "est une date d'échéance, pas la durée d'origine du prêt.";

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

type CreanceBucket = 'aUnAnAuPlus' | 'aPlusDUnAn';
type DetteBucket = 'aUnAnAuPlus' | 'aPlusDUnAnEt5AnsAuPlus' | 'aPlusDe5Ans';

function creanceBucket(
  code: string,
  dateEcheance: Date | null,
  fiscalYearEndDate: Date,
): CreanceBucket {
  if (!dateEcheance) {
    return LONG_TERM_BY_NATURE_CADRE_A_CODES.has(code) ? 'aPlusDUnAn' : 'aUnAnAuPlus';
  }
  return dateEcheance <= addYears(fiscalYearEndDate, 1) ? 'aUnAnAuPlus' : 'aPlusDUnAn';
}

function detteBucket(
  code: string,
  dateEcheance: Date | null,
  fiscalYearEndDate: Date,
): DetteBucket {
  if (!dateEcheance) {
    return LONG_TERM_BY_NATURE_CADRE_B_CODES.has(code) ? 'aPlusDUnAnEt5AnsAuPlus' : 'aUnAnAuPlus';
  }
  if (dateEcheance <= addYears(fiscalYearEndDate, 1)) {
    return 'aUnAnAuPlus';
  }
  return dateEcheance <= addYears(fiscalYearEndDate, 5) ? 'aPlusDUnAnEt5AnsAuPlus' : 'aPlusDe5Ans';
}

/**
 * Classifies every bilan-relevant (classes 1–5) raw ligne into its
 * Cadre A/B code (reusing bilan-2050's own rule tables via
 * resolveLineCode — the exact same classification montantBrut was
 * built from, just applied per-ligne instead of per aggregated
 * account), then buckets it by maturity. Lignes whose code isn't a
 * Cadre A/B code (immobilisations, stocks, disponibilités, capitaux
 * propres, ...) are silently skipped — 2057 only ever reports créances/
 * dettes lines.
 */
function buildMaturityTotals(
  rawLignes: Tableau2057RawLigne[],
  fiscalYearEndDate: Date,
): {
  creances: Map<string, Map<CreanceBucket, Money>>;
  dettes: Map<string, Map<DetteBucket, Money>>;
} {
  const relevant = rawLignes.filter((l) => l.pcgClass >= 1 && l.pcgClass <= 5);

  // Resolve each DISTINCT account to its bilan line code ONCE, from that account's own aggregate
  // balance across every one of its lignes this period — dual-nature routing (e.g. 512 → CF when
  // net debit vs DU when net credit/overdraft) depends on the ACCOUNT's net balance, never any
  // single ligne's own debit/credit sign. Resolving per-ligne instead (the first version of this
  // function did) misrouted individual credit-side lines on a net-debit bank account straight to
  // DU, wildly inflating it — caught by this function's own aUnAnAuPlus+aPlusDUnAn===montantBrut
  // check against bilan-2050's independently-computed aggregate, not by inspection.
  const aggregateByAccount = new Map<string, Money>();
  for (const ligne of relevant) {
    const balance = Money.fromDecimal(ligne.debit).minus(Money.fromDecimal(ligne.credit));
    aggregateByAccount.set(
      ligne.compteNumber,
      (aggregateByAccount.get(ligne.compteNumber) ?? Money.zero()).plus(balance),
    );
  }
  const codeByAccount = new Map<string, string>();
  for (const [accountNumber, balance] of aggregateByAccount) {
    codeByAccount.set(
      accountNumber,
      resolveLineCode(accountNumber, balance, [...ACTIF_RULES, ...PASSIF_RULES], DUAL_NATURE_RULES),
    );
  }

  const creances = new Map<string, Map<CreanceBucket, Money>>();
  const dettes = new Map<string, Map<DetteBucket, Money>>();

  for (const ligne of relevant) {
    const code = codeByAccount.get(ligne.compteNumber)!;
    const balance = Money.fromDecimal(ligne.debit).minus(Money.fromDecimal(ligne.credit));

    if (CADRE_A_CODES.has(code)) {
      const bucket = creanceBucket(code, ligne.dateEcheance, fiscalYearEndDate);
      const byBucket = creances.get(code) ?? new Map<CreanceBucket, Money>();
      byBucket.set(bucket, (byBucket.get(bucket) ?? Money.zero()).plus(balance));
      creances.set(code, byBucket);
    } else if (CADRE_B_CODES.has(code)) {
      const bucket = detteBucket(code, ligne.dateEcheance, fiscalYearEndDate);
      const byBucket = dettes.get(code) ?? new Map<DetteBucket, Money>();
      byBucket.set(bucket, (byBucket.get(bucket) ?? Money.zero()).minus(balance)); // credit-direction
      dettes.set(code, byBucket);
    }
    // Neither — an immobilisation/stock/disponibilité/capitaux-propres line, not a 2057 row.
  }

  return { creances, dettes };
}

export function computeTableau2057(
  bilan: Bilan2050,
  rawLignes: Tableau2057RawLigne[],
  fiscalYearEndDate: Date,
): Tableau2057 {
  const actifByCode = new Map(bilan.actif.map((l) => [l.code, l]));
  const passifByCode = new Map(bilan.passif.map((l) => [l.code, l]));
  const { creances, dettes } = buildMaturityTotals(rawLignes, fiscalYearEndDate);

  const cadreA: Tableau2057CadreALigne[] = CADRE_A_ROWS.map(({ code, label }) => {
    const ligne = actifByCode.get(code);
    if (!ligne) {
      throw new ConflictException(
        `Bilan2050.actif has no line "${code}" — computeBilan2050() should always produce every ` +
          'ACTIF_ROWS line, even at 0,00. This is a bilan mapping bug, not a 2057 problem.',
      );
    }
    const byBucket = creances.get(code) ?? new Map<CreanceBucket, Money>();
    const aUnAnAuPlus = byBucket.get('aUnAnAuPlus') ?? Money.zero();
    const aPlusDUnAn = byBucket.get('aPlusDUnAn') ?? Money.zero();
    const montantBrut = Money.fromString(ligne.brut);
    if (!aUnAnAuPlus.plus(aPlusDUnAn).equals(montantBrut)) {
      throw new ConflictException(
        `Ligne ${code}: maturity split (${aUnAnAuPlus.toApiString()} + ${aPlusDUnAn.toApiString()}) ` +
          `does not equal the bilan's montant brut (${montantBrut.toApiString()}). The raw-ligne pass ` +
          "and bilan-2050's own aggregate classification have diverged for this account — a mapping " +
          'bug, not a data problem.',
      );
    }
    return {
      code,
      label,
      montantBrut: ligne.brut,
      aUnAnAuPlus: aUnAnAuPlus.toApiString(),
      aPlusDUnAn: aPlusDUnAn.toApiString(),
    };
  });

  const cadreB: Tableau2057CadreBLigne[] = CADRE_B_ROWS.map(({ code, label }) => {
    const ligne = passifByCode.get(code);
    if (!ligne) {
      throw new ConflictException(
        `Bilan2050.passif has no line "${code}" — computeBilan2050() should always produce every ` +
          'PASSIF_RULES line, even at 0,00. This is a bilan mapping bug, not a 2057 problem.',
      );
    }
    const byBucket = dettes.get(code) ?? new Map<DetteBucket, Money>();
    const aUnAnAuPlus = byBucket.get('aUnAnAuPlus') ?? Money.zero();
    const aPlusDUnAnEt5AnsAuPlus = byBucket.get('aPlusDUnAnEt5AnsAuPlus') ?? Money.zero();
    const aPlusDe5Ans = byBucket.get('aPlusDe5Ans') ?? Money.zero();
    const montantBrut = Money.fromString(ligne.montant);
    if (!aUnAnAuPlus.plus(aPlusDUnAnEt5AnsAuPlus).plus(aPlusDe5Ans).equals(montantBrut)) {
      throw new ConflictException(
        `Ligne ${code}: maturity split (${aUnAnAuPlus.toApiString()} + ` +
          `${aPlusDUnAnEt5AnsAuPlus.toApiString()} + ${aPlusDe5Ans.toApiString()}) does not equal the ` +
          `bilan's montant (${montantBrut.toApiString()}). The raw-ligne pass and bilan-2050's own ` +
          'aggregate classification have diverged for this account — a mapping bug, not a data problem.',
      );
    }
    return {
      code,
      label,
      montantBrut: ligne.montant,
      aUnAnAuPlus: aUnAnAuPlus.toApiString(),
      aPlusDUnAnEt5AnsAuPlus: aPlusDUnAnEt5AnsAuPlus.toApiString(),
      aPlusDe5Ans: aPlusDe5Ans.toApiString(),
    };
  });

  const sumBrut = (lignes: { montantBrut: string }[]) =>
    lignes
      .reduce((sum, l) => sum.plus(Money.fromString(l.montantBrut)), Money.zero())
      .toApiString();

  return {
    cadreA,
    totalCreances: sumBrut(cadreA),
    cadreB,
    totalDettes: sumBrut(cadreB),
    note: NOTE,
    maturityNote: MATURITY_NOTE,
  };
}
