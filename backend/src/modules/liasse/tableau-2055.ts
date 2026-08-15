import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { resolveImmobilisationCategory } from './immobilisation-categories';

/**
 * 2055-SD (Amortissements), Cadre A only — movement of amortissements
 * over the fiscal year. See
 * specs/liasse-2054-2055-implementation-spec.md §2/§3/§5 and CLAUDE.md
 * "Immobilisations / cession" for how "reprises" is now real.
 *
 * Cadre B (amortissements dérogatoires) is not represented here at
 * all — structurally N/A, not deferred: it only arises when the tax
 * depreciation method (dégressif, exceptionnel) diverges from the book
 * method (linéaire), and this app only computes linéaire
 * (DepreciationMethod.DECLINING throws NotImplementedException), so
 * there is no divergence to report for any asset this app can
 * depreciate. Cadre C (charges réparties sur plusieurs exercices) is a
 * different asset class entirely, not FixedAsset-based — also not
 * represented.
 *
 * Diminutions (Cadre A col 3 — amortissements afférents aux éléments
 * sortis de l'actif et reprises) is real: `disposals` carries one entry
 * per asset disposed within the reported fiscal year, with its
 * cumulative posted amortissements AT disposal (already includes that
 * year's own, possibly prorated, final dotation). This is passed as its
 * own explicit list rather than derived from `entries` — `entries` is
 * flattened per (account, fiscalYear), and since multiple assets can
 * share one account, there's no way to attribute "this account's total"
 * to one specific disposed asset from the flattened shape alone.
 */

export interface ImmobilisationDepreciationMovement {
  accountNumber: string;
  fiscalYearId: string;
  /** The posted entry's own fiscal year end date — used only for the defensive out-of-period guard below. */
  fiscalYearEndDate: Date;
  amount: Money;
}

export interface ImmobilisationDisposal {
  accountNumber: string;
  /** Cumulative posted amortissements for this specific asset at the date of disposal. */
  amortissementsCumules: Money;
}

export interface Tableau2055Ligne {
  code: string;
  label: string;
  montantDebut: string;
  dotations: string;
  /** Sum of amortissementsCumules-at-disposal for assets in this category disposed within the reported fiscal year. */
  diminutions: string;
  montantFin: string;
}

export interface Tableau2055 {
  lignes: Tableau2055Ligne[];
  /** TOTAL I (fin). */
  totalIncorporelles: string;
  /** TOTAL II (fin). */
  totalCorporelles: string;
  /** TOTAL GÉNÉRAL I+II (fin) — no financières section, immobilisations financières aren't amortized. */
  totalGeneral: string;
}

/**
 * 2055's own row grouping — unlike 2054, fonds commercial gets its own
 * dedicated row here (2055's form prints it separately); "en cours",
 * "avances et acomptes", and financières categories have no row at all
 * (none of those are ever depreciated) — see module doc comment and
 * resolveMovementCategory below for what happens if data shows up in
 * one of those categories anyway.
 */
const ROWS_2055: { code: string; label: string; categories: string[] }[] = [
  {
    code: 'FRAIS_ETABLISSEMENT_DEV',
    label: "Frais d'établissement et de développement",
    categories: ['FRAIS_ETABLISSEMENT_DEV'],
  },
  { code: 'FONDS_COMMERCIAL', label: 'Fonds commercial', categories: ['FONDS_COMMERCIAL'] },
  {
    code: 'AUTRES_INCORPORELLES',
    label: 'Autres immobilisations incorporelles',
    categories: ['AUTRES_INCORPORELLES'],
  },
  { code: 'TERRAINS', label: 'Terrains', categories: ['TERRAINS'] },
  {
    code: 'CONSTRUCTIONS_SOL_PROPRE',
    label: 'Constructions — sur sol propre',
    categories: ['CONSTRUCTIONS_SOL_PROPRE'],
  },
  {
    code: 'CONSTRUCTIONS_SOL_AUTRUI',
    label: "Constructions — sur sol d'autrui",
    categories: ['CONSTRUCTIONS_SOL_AUTRUI'],
  },
  {
    code: 'CONSTRUCTIONS_INST_GENERALES',
    label: 'Constructions — installations générales, agencements, aménagements des constructions',
    categories: ['CONSTRUCTIONS_INST_GENERALES'],
  },
  {
    code: 'INSTALLATIONS_TECHNIQUES',
    label: 'Installations techniques, matériel et outillage industriels',
    categories: ['INSTALLATIONS_TECHNIQUES'],
  },
  {
    code: 'AUTRES_CORP_INST_GENERALES',
    label: 'Autres immo. corp. — installations générales, agencements, aménagements divers',
    categories: ['AUTRES_CORP_INST_GENERALES'],
  },
  {
    code: 'AUTRES_CORP_MATERIEL_TRANSPORT',
    label: 'Autres immo. corp. — matériel de transport',
    categories: ['AUTRES_CORP_MATERIEL_TRANSPORT'],
  },
  {
    code: 'AUTRES_CORP_MATERIEL_BUREAU',
    label: 'Autres immo. corp. — matériel de bureau et informatique, mobilier',
    categories: ['AUTRES_CORP_MATERIEL_BUREAU'],
  },
  {
    code: 'AUTRES_CORP_EMBALLAGES',
    label: 'Autres immo. corp. — emballages récupérables et divers',
    categories: ['AUTRES_CORP_EMBALLAGES'],
  },
];

const INCORPORELLES_CODES = ['FRAIS_ETABLISSEMENT_DEV', 'FONDS_COMMERCIAL', 'AUTRES_INCORPORELLES'];
const CORPORELLES_CODES = [
  'TERRAINS',
  'CONSTRUCTIONS_SOL_PROPRE',
  'CONSTRUCTIONS_SOL_AUTRUI',
  'CONSTRUCTIONS_INST_GENERALES',
  'INSTALLATIONS_TECHNIQUES',
  'AUTRES_CORP_INST_GENERALES',
  'AUTRES_CORP_MATERIEL_TRANSPORT',
  'AUTRES_CORP_MATERIEL_BUREAU',
  'AUTRES_CORP_EMBALLAGES',
];
const ROW_CODES = new Set([...INCORPORELLES_CODES, ...CORPORELLES_CODES]);

/**
 * Pure computation, no I/O. `entries` must already be scoped to
 * `fiscalYear.endDate <= reportedFiscalYear.endDate` by the caller
 * (same precondition as buildVncByLine's now-fixed query) — this
 * function defensively re-checks that and throws rather than silently
 * counting a later year's dotation as this year's or as "début".
 */
export function computeTableau2055(
  entries: ImmobilisationDepreciationMovement[],
  reportedFiscalYear: { id: string; endDate: Date },
  disposals: ImmobilisationDisposal[] = [],
): Tableau2055 {
  const byCategory = new Map<string, { debut: Money; dotations: Money; diminutions: Money }>();
  for (const entry of entries) {
    if (entry.fiscalYearEndDate > reportedFiscalYear.endDate) {
      throw new ConflictException(
        `A depreciation entry for account "${entry.accountNumber}" belongs to a fiscal year ending ` +
          `${entry.fiscalYearEndDate.toISOString().slice(0, 10)}, after the reported fiscal year ends ` +
          `(${reportedFiscalYear.endDate.toISOString().slice(0, 10)}) — it must be excluded by the ` +
          'caller before computing 2055, not passed in.',
      );
    }
    const category = resolveImmobilisationCategory(entry.accountNumber);
    if (!ROW_CODES.has(category.code)) {
      throw new ConflictException(
        `Account "${entry.accountNumber}" has a posted depreciation entry but its category ` +
          `(${category.code}) has no 2055 row — immobilisations en cours, avances, and financières ` +
          'are never amortized. This usually means an asset was assigned the wrong account.',
      );
    }
    const bucket = byCategory.get(category.code) ?? {
      debut: Money.zero(),
      dotations: Money.zero(),
      diminutions: Money.zero(),
    };
    if (entry.fiscalYearId === reportedFiscalYear.id) {
      bucket.dotations = bucket.dotations.plus(entry.amount);
    } else {
      bucket.debut = bucket.debut.plus(entry.amount);
    }
    byCategory.set(category.code, bucket);
  }

  for (const disposal of disposals) {
    const category = resolveImmobilisationCategory(disposal.accountNumber);
    if (!ROW_CODES.has(category.code)) {
      throw new ConflictException(
        `Account "${disposal.accountNumber}" has a disposal but its category (${category.code}) has ` +
          'no 2055 row — immobilisations en cours, avances, and financières are never amortized.',
      );
    }
    const bucket = byCategory.get(category.code) ?? {
      debut: Money.zero(),
      dotations: Money.zero(),
      diminutions: Money.zero(),
    };
    bucket.diminutions = bucket.diminutions.plus(disposal.amortissementsCumules);
    byCategory.set(category.code, bucket);
  }

  const lignes: Tableau2055Ligne[] = ROWS_2055.map((row) => {
    let debut = Money.zero();
    let dotations = Money.zero();
    let diminutions = Money.zero();
    for (const categoryCode of row.categories) {
      const bucket = byCategory.get(categoryCode);
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
      montantDebut: debut.toApiString(),
      dotations: dotations.toApiString(),
      diminutions: diminutions.toApiString(),
      montantFin: fin.toApiString(),
    };
  });

  const sumFin = (codes: string[]) =>
    lignes
      .filter((l) => codes.includes(l.code))
      .reduce((sum, l) => sum.plus(Money.fromString(l.montantFin)), Money.zero());

  return {
    lignes,
    totalIncorporelles: sumFin(INCORPORELLES_CODES).toApiString(),
    totalCorporelles: sumFin(CORPORELLES_CODES).toApiString(),
    totalGeneral: sumFin([...INCORPORELLES_CODES, ...CORPORELLES_CODES]).toApiString(),
  };
}
