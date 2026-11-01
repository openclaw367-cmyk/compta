import { Money } from '../../common/decimal';
import { resolveImmobilisationCategory } from './immobilisation-categories';
import { ImmobilisationMovementAsset, classifyAssetContributions } from './tableau-2054';
import {
  ImmobilisationDepreciationMovement,
  ImmobilisationDisposal,
  classifyDepreciationEntry,
  classifyDisposal,
} from './tableau-2055';

/**
 * 2033-C-SD, Cadre I (IMMOBILISATIONS) + Cadre II (AMORTISSEMENTS) —
 * régime réel simplifié's own movement annexe, the direct analog of
 * 2054/2055 for the 2050-series. Primary source confirmed by rendering
 * `specs/2033-sd_5394.pdf` page 3 to an image (same discipline
 * bilan-2033-a.ts/compte-resultat-2033-b.ts's own doc comments already
 * establish — `pdftotext`'s reading order for this grid is NOT reliable
 * enough to trust for case-number/label pairing) and reading the case
 * numbers directly off the grid, not text extraction alone.
 *
 * **Cadre III (PLUS-VALUES, MOINS-VALUES à 19 %, 15 % et 0 %) is
 * deliberately NOT represented here** — out of scope for this pass, same
 * "flag, don't fake" discipline as every other stated gap in this
 * codebase. 2033-C-SD's own Cadre III is this regime's analog of
 * 2059-A, which stays open for a future pass (see CLAUDE.md "Liasse
 * fiscale — régime réel simplifié (2033-series)").
 *
 * **Réévaluation légale (Cadre I's 5th column) is also NOT represented**
 * — no revaluation field exists on `FixedAsset`, the exact same
 * structural (not deferred) gap `tableau-2054.ts`'s own doc comment
 * already states for 2054's own réévaluation column.
 *
 * Reuses the SAME underlying data and movement technique as 2054/2055
 * verbatim — `classifyAssetContributions()` (Cadre I) and
 * `classifyDepreciationEntry()`/`classifyDisposal()` (Cadre II) are
 * imported directly from `tableau-2054.ts`/`tableau-2055.ts`, never
 * re-derived. Only the ROW GROUPING differs (2033-C is coarser than
 * 2054/2055 — see ROWS_2033C_IMMOBILISATIONS/ROWS_2033C_AMORTISSEMENTS
 * below for exactly how each finer `IMMOBILISATION_CATEGORIES` code
 * folds into this form's own, coarser case-numbered rows), the SAME
 * "coarser-form-reuses-finer-engine" relationship bilan-2033-a.ts has
 * to bilan-2050.ts.
 *
 * "Diminutions" on this form is ONE column (unlike 2054's own split
 * cessions/virements) — per the form's own column header
 * ("Diminutions", directly between "Augmentations" and the closing
 * "Valeur brute ... fin"), it folds cessions, mises hors service, and
 * virements de poste à poste together. Since this app has no
 * reclassify/virements mechanism (FixedAsset has no update endpoint —
 * same gap 2054 already states), diminutions here is exactly cessions,
 * same underlying figure as 2054's own `cessions` column.
 */

/** Cadre I (IMMOBILISATIONS) row — code is the form's own "début" case number. */
export interface Tableau2033CImmobilisationLigne {
  code: string;
  label: string;
  debut: string;
  augmentations: string;
  /** Cessions — see module doc comment for why this folds what the form calls "Diminutions". */
  diminutions: string;
  fin: string;
}

export interface Tableau2033CImmobilisations {
  lignes: Tableau2033CImmobilisationLigne[];
  /** Case 490 — TOTAL (début). */
  totalDebut: string;
  /** Case 492 — TOTAL (augmentations). */
  totalAugmentations: string;
  /** Case 494 — TOTAL (diminutions). */
  totalDiminutions: string;
  /** Case 496 — TOTAL (fin). */
  totalFin: string;
}

/** Cadre II (AMORTISSEMENTS) row — code is the form's own "début" case number, a DIFFERENT namespace from Cadre I's. */
export interface Tableau2033CAmortissementLigne {
  code: string;
  label: string;
  debut: string;
  dotations: string;
  diminutions: string;
  fin: string;
}

export interface Tableau2033CAmortissements {
  /** Case 570 — TOTAL (début). */
  totalDebut: string;
  /** Case 572 — TOTAL (dotations). */
  totalDotations: string;
  /** Case 574 — TOTAL (diminutions). */
  totalDiminutions: string;
  /** Case 576 — TOTAL (fin). */
  totalFin: string;
  lignes: Tableau2033CAmortissementLigne[];
}

export interface Tableau2033C {
  immobilisations: Tableau2033CImmobilisations;
  amortissements: Tableau2033CAmortissements;
}

/**
 * Cadre I's own row grouping, case numbers quoted verbatim off the
 * rendered form (début/augmentations/diminutions/fin — 4 cases per row,
 * +4 before the next row). "Autres" (incorporelles, case 410) folds
 * FRAIS_ETABLISSEMENT_DEV + AUTRES_INCORPORELLES — the EXACT SAME
 * grouping bilan-2033-a.ts's own case '014' ("Autres immobilisations
 * incorporelles") already uses (201/203/205/206/208/232/237), confirmed
 * by comparing the two prefix sets directly, not re-derived. "Autres
 * immobilisations corporelles" (case 470) is this form's residual
 * corporelle row — it also folds IMMOS_CORP_EN_COURS (231) and
 * AVANCES_ACOMPTES (238), which have no dedicated row here (2054 gives
 * them their own rows; 2033-C does not) — same "no dedicated line →
 * route to nearest documented catch-all" convention bilan-2033-a.ts's
 * own doc comment already established (206→014, 1062→132), confirmed
 * consistent with bilan-2033-a.ts's own case '028' (which folds the
 * SAME 231/238 into the single "Immobilisations corporelles" line when
 * this form is at its COARSEST, i.e. 2033-A's own bilan).
 * "Immobilisations financières" (case 480) folds AUTRES_PARTICIPATIONS +
 * AUTRES_TITRES_IMMOBILISES + PRETS_AUTRES_IMMO_FINANCIERES — the same
 * three categories 2054's own FINANCIERES_CODES groups together.
 */
const ROWS_2033C_IMMOBILISATIONS: {
  code: string;
  label: string;
  categories: string[];
}[] = [
  { code: '400', label: 'Fonds commercial', categories: ['FONDS_COMMERCIAL'] },
  {
    code: '410',
    label: 'Autres (immobilisations incorporelles)',
    categories: ['FRAIS_ETABLISSEMENT_DEV', 'AUTRES_INCORPORELLES'],
  },
  { code: '420', label: 'Terrains', categories: ['TERRAINS'] },
  {
    code: '430',
    label: 'Constructions',
    categories: [
      'CONSTRUCTIONS_SOL_PROPRE',
      'CONSTRUCTIONS_SOL_AUTRUI',
      'CONSTRUCTIONS_INST_GENERALES',
    ],
  },
  {
    code: '440',
    label: 'Installations techniques, matériel et outillage industriels',
    categories: ['INSTALLATIONS_TECHNIQUES'],
  },
  {
    code: '450',
    label: 'Installations générales, agencements, aménagements divers',
    categories: ['AUTRES_CORP_INST_GENERALES'],
  },
  {
    code: '460',
    label: 'Matériel de transport',
    categories: ['AUTRES_CORP_MATERIEL_TRANSPORT'],
  },
  {
    code: '470',
    label: 'Autres immobilisations corporelles',
    categories: [
      'AUTRES_CORP_MATERIEL_BUREAU',
      'AUTRES_CORP_EMBALLAGES',
      'IMMOS_CORP_EN_COURS',
      'AVANCES_ACOMPTES',
    ],
  },
  {
    code: '480',
    label: 'Immobilisations financières',
    categories: [
      'AUTRES_PARTICIPATIONS',
      'AUTRES_TITRES_IMMOBILISES',
      'PRETS_AUTRES_IMMO_FINANCIERES',
    ],
  },
];

/**
 * Cadre II's own row grouping — same 8 "nature" buckets as Cadre I minus
 * "Immobilisations financières" (never amortized, no row at all, same
 * form-structural fact 2055's own ROWS_2055 already reflects) — but each
 * category list here is additionally constrained to exactly what
 * `classifyDepreciationEntry()`/`classifyDisposal()` (tableau-2055.ts's
 * own `ROW_CODES`) will ever hand back: IMMOS_CORP_EN_COURS and
 * AVANCES_ACOMPTES never appear in a depreciation entry at all (an
 * asset "en cours" or an "avance" is never amortized — 2055 itself
 * throws if one somehow is), so "Autres immobilisations corporelles"
 * (case 560) is narrower here than its Cadre I counterpart (case 470),
 * by form-structural necessity, not an oversight.
 */
const ROWS_2033C_AMORTISSEMENTS: {
  code: string;
  label: string;
  categories: string[];
}[] = [
  { code: '495', label: 'Fonds commercial', categories: ['FONDS_COMMERCIAL'] },
  {
    code: '500',
    label: 'Autres immobilisations incorporelles',
    categories: ['FRAIS_ETABLISSEMENT_DEV', 'AUTRES_INCORPORELLES'],
  },
  { code: '510', label: 'Terrains', categories: ['TERRAINS'] },
  {
    code: '520',
    label: 'Constructions',
    categories: [
      'CONSTRUCTIONS_SOL_PROPRE',
      'CONSTRUCTIONS_SOL_AUTRUI',
      'CONSTRUCTIONS_INST_GENERALES',
    ],
  },
  {
    code: '530',
    label: 'Installations techniques, matériel et outillage industriels',
    categories: ['INSTALLATIONS_TECHNIQUES'],
  },
  {
    code: '540',
    label: 'Installations générales, agencements, aménagements divers',
    categories: ['AUTRES_CORP_INST_GENERALES'],
  },
  {
    code: '550',
    label: 'Matériel de transport',
    categories: ['AUTRES_CORP_MATERIEL_TRANSPORT'],
  },
  {
    code: '560',
    label: 'Autres immobilisations corporelles',
    categories: ['AUTRES_CORP_MATERIEL_BUREAU', 'AUTRES_CORP_EMBALLAGES'],
  },
];

/**
 * Pure computation, no I/O, same precondition contract as
 * `computeTableau2054()`/`computeTableau2055()`: `assets` must already
 * be scoped to `acquisitionDate <= fiscalYear.endDate` and `entries`
 * scoped to `fiscalYear.endDate <= reportedFiscalYear.endDate` — both
 * reused functions defensively re-check this themselves and throw
 * rather than silently misclassifying an out-of-period item, exactly
 * as they already do for 2054/2055.
 */
export function computeTableau2033C(
  assets: ImmobilisationMovementAsset[],
  fiscalYear: { startDate: Date; endDate: Date },
  entries: ImmobilisationDepreciationMovement[],
  reportedFiscalYear: { id: string; endDate: Date },
  disposals: ImmobilisationDisposal[] = [],
): Tableau2033C {
  // Cadre I — identical accumulation shape to computeTableau2054(), reusing the SAME
  // classifyAssetContributions() primitive, just regrouped into 2033-C's own coarser rows below.
  const byCategoryImmob = new Map<
    string,
    { debut: Money; augmentations: Money; diminutions: Money }
  >();
  for (const asset of assets) {
    for (const { categoryCode, column, contribution } of classifyAssetContributions(
      asset,
      fiscalYear,
    )) {
      const bucket = byCategoryImmob.get(categoryCode) ?? {
        debut: Money.zero(),
        augmentations: Money.zero(),
        diminutions: Money.zero(),
      };
      const mappedColumn =
        column === 'acquisitions'
          ? 'augmentations'
          : column === 'cessions'
            ? 'diminutions'
            : 'debut';
      bucket[mappedColumn] = bucket[mappedColumn].plus(contribution);
      byCategoryImmob.set(categoryCode, bucket);
    }
  }

  const immobLignes: Tableau2033CImmobilisationLigne[] = ROWS_2033C_IMMOBILISATIONS.map((row) => {
    let debut = Money.zero();
    let augmentations = Money.zero();
    let diminutions = Money.zero();
    for (const categoryCode of row.categories) {
      const bucket = byCategoryImmob.get(categoryCode);
      if (bucket) {
        debut = debut.plus(bucket.debut);
        augmentations = augmentations.plus(bucket.augmentations);
        diminutions = diminutions.plus(bucket.diminutions);
      }
    }
    const fin = debut.plus(augmentations).minus(diminutions);
    return {
      code: row.code,
      label: row.label,
      debut: debut.toApiString(),
      augmentations: augmentations.toApiString(),
      diminutions: diminutions.toApiString(),
      fin: fin.toApiString(),
    };
  });

  const sumImmob = (field: 'debut' | 'augmentations' | 'diminutions' | 'fin') =>
    immobLignes.reduce((sum, l) => sum.plus(Money.fromString(l[field])), Money.zero());

  // Cadre II — identical accumulation shape to computeTableau2055(), reusing the SAME
  // classifyDepreciationEntry()/classifyDisposal() primitives.
  const byCategoryAmort = new Map<string, { debut: Money; dotations: Money; diminutions: Money }>();
  for (const entry of entries) {
    const { categoryCode, column, contribution } = classifyDepreciationEntry(
      entry,
      reportedFiscalYear,
    );
    const bucket = byCategoryAmort.get(categoryCode) ?? {
      debut: Money.zero(),
      dotations: Money.zero(),
      diminutions: Money.zero(),
    };
    bucket[column] = bucket[column].plus(contribution);
    byCategoryAmort.set(categoryCode, bucket);
  }
  for (const disposal of disposals) {
    const { categoryCode, contribution } = classifyDisposal(disposal);
    const bucket = byCategoryAmort.get(categoryCode) ?? {
      debut: Money.zero(),
      dotations: Money.zero(),
      diminutions: Money.zero(),
    };
    bucket.diminutions = bucket.diminutions.plus(contribution);
    byCategoryAmort.set(categoryCode, bucket);
  }

  const amortLignes: Tableau2033CAmortissementLigne[] = ROWS_2033C_AMORTISSEMENTS.map((row) => {
    let debut = Money.zero();
    let dotations = Money.zero();
    let diminutions = Money.zero();
    for (const categoryCode of row.categories) {
      const bucket = byCategoryAmort.get(categoryCode);
      if (bucket) {
        debut = debut.plus(bucket.debut);
        dotations = dotations.plus(bucket.dotations);
        diminutions = diminutions.plus(bucket.diminutions);
      }
    }
    const fin = debut.plus(dotations).minus(diminutions);
    return {
      code: row.code,
      label: row.label,
      debut: debut.toApiString(),
      dotations: dotations.toApiString(),
      diminutions: diminutions.toApiString(),
      fin: fin.toApiString(),
    };
  });

  const sumAmort = (field: 'debut' | 'dotations' | 'diminutions' | 'fin') =>
    amortLignes.reduce((sum, l) => sum.plus(Money.fromString(l[field])), Money.zero());

  return {
    immobilisations: {
      lignes: immobLignes,
      totalDebut: sumImmob('debut').toApiString(),
      totalAugmentations: sumImmob('augmentations').toApiString(),
      totalDiminutions: sumImmob('diminutions').toApiString(),
      totalFin: sumImmob('fin').toApiString(),
    },
    amortissements: {
      lignes: amortLignes,
      totalDebut: sumAmort('debut').toApiString(),
      totalDotations: sumAmort('dotations').toApiString(),
      totalDiminutions: sumAmort('diminutions').toApiString(),
      totalFin: sumAmort('fin').toApiString(),
    },
  };
}

// Re-exported so a caller that only knows about tableau-2033-c.ts can resolve a raw account number
// to its category without a separate import — purely a convenience, not a new primitive.
export { resolveImmobilisationCategory };
