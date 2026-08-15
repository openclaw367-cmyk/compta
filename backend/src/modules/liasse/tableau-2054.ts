import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { resolveImmobilisationCategory } from './immobilisation-categories';

/**
 * 2054-SD (Immobilisations), Cadre A/B — movement of gross
 * immobilisation values over the fiscal year. See
 * specs/liasse-2054-2055-implementation-spec.md §2/§3/§5 and CLAUDE.md
 * "Immobilisations / cession" for how cessions are now real.
 *
 * Cessions (Cadre B col 2) is real: an asset whose cessionDate falls
 * within the reported fiscal year contributes its valeurBrute to the
 * category's cessions bucket, and `fin` is now `debut + acquisitions −
 * cessions`. An asset disposed in a STRICTLY EARLIER fiscal year is
 * skipped entirely (no contribution to début either) — it's gone
 * before this year even starts; the caller (liasse.service.ts's
 * fetchImmobilisations) already excludes such assets at the query
 * level, this is a defensive re-check, not the load-bearing filter.
 * Virements de poste à poste (Cadre A col 3's other half, Cadre B col
 * 1) stay always 0.00 — FixedAsset has no update/reclassify endpoint,
 * unrelated to cession. The réévaluation/mise-en-équivalence columns
 * (Cadre A col 2, Cadre B col 4) aren't in this output at all — no
 * revaluation field exists on FixedAsset, structurally out of scope,
 * not a zero-valued gap.
 */

export interface ImmobilisationMovementAsset {
  accountNumber: string;
  acquisitionDate: Date;
  acquisitionValue: Money;
  /** Null if never disposed. See module doc comment for how this drives the cessions column. */
  cessionDate: Date | null;
}

export interface Tableau2054Ligne {
  /** Internal category code (not a literal cerfa code — see module doc comment). */
  code: string;
  label: string;
  valeurBruteDebut: string;
  acquisitions: string;
  /** Sum of valeurBrute for assets in this category disposed within the reported fiscal year. */
  cessions: string;
  /** Always "0.00" — FixedAsset has no update/reclassify endpoint. */
  virements: string;
  valeurBruteFin: string;
}

export interface Tableau2054 {
  lignes: Tableau2054Ligne[];
  /** TOTAL I + II (fin). */
  totalIncorporelles: string;
  /** TOTAL III (fin). */
  totalCorporelles: string;
  /** TOTAL IV (fin). */
  totalFinancieres: string;
  /** TOTAL GÉNÉRAL I+II+III+IV (fin). */
  totalGeneral: string;
}

/**
 * 2054's own row grouping — note "AUTRES_POSTES_INCORPORELLES" combines
 * two categories (FONDS_COMMERCIAL + AUTRES_INCORPORELLES) into one row,
 * because 2054 has no dedicated fonds-commercial line the way 2055
 * does — see specs/liasse-2054-2055-implementation-spec.md §3d for why
 * the two forms are deliberately not mapped with forced parity.
 */
const ROWS_2054: { code: string; label: string; categories: string[] }[] = [
  {
    code: 'FRAIS_ETABLISSEMENT_DEV',
    label: "Frais d'établissement et de développement",
    categories: ['FRAIS_ETABLISSEMENT_DEV'],
  },
  {
    code: 'AUTRES_POSTES_INCORPORELLES',
    label: "Autres postes d'immobilisations incorporelles",
    categories: ['FONDS_COMMERCIAL', 'AUTRES_INCORPORELLES'],
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
    label: 'Autres immo. corp. — matériel de bureau et mobilier informatique',
    categories: ['AUTRES_CORP_MATERIEL_BUREAU'],
  },
  {
    code: 'AUTRES_CORP_EMBALLAGES',
    label: 'Autres immo. corp. — emballages récupérables et divers',
    categories: ['AUTRES_CORP_EMBALLAGES'],
  },
  {
    code: 'IMMOS_CORP_EN_COURS',
    label: 'Immobilisations corporelles en cours',
    categories: ['IMMOS_CORP_EN_COURS'],
  },
  { code: 'AVANCES_ACOMPTES', label: 'Avances et acomptes', categories: ['AVANCES_ACOMPTES'] },
  {
    code: 'AUTRES_PARTICIPATIONS',
    label: 'Autres participations',
    categories: ['AUTRES_PARTICIPATIONS'],
  },
  {
    code: 'AUTRES_TITRES_IMMOBILISES',
    label: 'Autres titres immobilisés',
    categories: ['AUTRES_TITRES_IMMOBILISES'],
  },
  {
    code: 'PRETS_AUTRES_IMMO_FINANCIERES',
    label: 'Prêts et autres immobilisations financières',
    categories: ['PRETS_AUTRES_IMMO_FINANCIERES'],
  },
];

const INCORPORELLES_CODES = ['FRAIS_ETABLISSEMENT_DEV', 'AUTRES_POSTES_INCORPORELLES'];
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
  'IMMOS_CORP_EN_COURS',
  'AVANCES_ACOMPTES',
];
const FINANCIERES_CODES = [
  'AUTRES_PARTICIPATIONS',
  'AUTRES_TITRES_IMMOBILISES',
  'PRETS_AUTRES_IMMO_FINANCIERES',
];

/**
 * Pure computation, no I/O. `assets` must already be scoped to
 * `acquisitionDate <= fiscalYear.endDate` by the caller — this function
 * defensively re-checks that and throws rather than silently
 * misclassifying an out-of-period asset as this year's acquisition,
 * the same failure mode the buildVncByLine() bug (fixed separately)
 * exhibited.
 */
export function computeTableau2054(
  assets: ImmobilisationMovementAsset[],
  fiscalYear: { startDate: Date; endDate: Date },
): Tableau2054 {
  const byCategory = new Map<string, { debut: Money; acquisitions: Money; cessions: Money }>();
  for (const asset of assets) {
    if (asset.acquisitionDate > fiscalYear.endDate) {
      throw new ConflictException(
        `Asset with account "${asset.accountNumber}" was acquired on ` +
          `${asset.acquisitionDate.toISOString().slice(0, 10)}, after the reported fiscal year ends ` +
          `(${fiscalYear.endDate.toISOString().slice(0, 10)}) — it must be excluded by the caller ` +
          'before computing 2054, not passed in.',
      );
    }
    // Disposed in a strictly earlier fiscal year — gone before this year even starts, no
    // contribution to début/acquisitions/cessions at all. The caller's fetch already excludes
    // this case at the query level; this is a defensive re-check, not the load-bearing filter.
    if (asset.cessionDate && asset.cessionDate < fiscalYear.startDate) {
      continue;
    }

    const category = resolveImmobilisationCategory(asset.accountNumber);
    const bucket = byCategory.get(category.code) ?? {
      debut: Money.zero(),
      acquisitions: Money.zero(),
      cessions: Money.zero(),
    };
    if (asset.acquisitionDate < fiscalYear.startDate) {
      bucket.debut = bucket.debut.plus(asset.acquisitionValue);
    } else {
      bucket.acquisitions = bucket.acquisitions.plus(asset.acquisitionValue);
    }
    if (
      asset.cessionDate &&
      asset.cessionDate >= fiscalYear.startDate &&
      asset.cessionDate <= fiscalYear.endDate
    ) {
      bucket.cessions = bucket.cessions.plus(asset.acquisitionValue);
    }
    byCategory.set(category.code, bucket);
  }

  const lignes: Tableau2054Ligne[] = ROWS_2054.map((row) => {
    let debut = Money.zero();
    let acquisitions = Money.zero();
    let cessions = Money.zero();
    for (const categoryCode of row.categories) {
      const bucket = byCategory.get(categoryCode);
      if (bucket) {
        debut = debut.plus(bucket.debut);
        acquisitions = acquisitions.plus(bucket.acquisitions);
        cessions = cessions.plus(bucket.cessions);
      }
    }
    const fin = debut.plus(acquisitions).minus(cessions); // virements always 0 — see module doc comment
    return {
      code: row.code,
      label: row.label,
      valeurBruteDebut: debut.toApiString(),
      acquisitions: acquisitions.toApiString(),
      cessions: cessions.toApiString(),
      virements: '0.00',
      valeurBruteFin: fin.toApiString(),
    };
  });

  const sumFin = (codes: string[]) =>
    lignes
      .filter((l) => codes.includes(l.code))
      .reduce((sum, l) => sum.plus(Money.fromString(l.valeurBruteFin)), Money.zero());

  return {
    lignes,
    totalIncorporelles: sumFin(INCORPORELLES_CODES).toApiString(),
    totalCorporelles: sumFin(CORPORELLES_CODES).toApiString(),
    totalFinancieres: sumFin(FINANCIERES_CODES).toApiString(),
    totalGeneral: sumFin([
      ...INCORPORELLES_CODES,
      ...CORPORELLES_CODES,
      ...FINANCIERES_CODES,
    ]).toApiString(),
  };
}
