import { BadRequestException } from '@nestjs/common';

/**
 * The finer immobilisation categories 2054/2055 want — see
 * specs/liasse-2054-2055-implementation-spec.md §3c. Deliberately finer
 * than bilan-2050.ts's resolveImmobilisationLineCode() (which collapses
 * Constructions into one AP line and Autres corporelles into one AT
 * line): 2054/2055 print separate rows for each of these, and each
 * form assembles its own output rows from these shared categories
 * differently — see tableau-2054.ts / tableau-2055.ts.
 */

export interface ImmobilisationCategory {
  code: string;
  /** 2054's row label — may differ from 2055's for the same category (fonds commercial). */
  label2054: string;
  label2055: string;
  prefixes: string[];
}

export const IMMOBILISATION_CATEGORIES: ImmobilisationCategory[] = [
  {
    code: 'FRAIS_ETABLISSEMENT_DEV',
    label2054: "Frais d'établissement et de développement",
    label2055: "Frais d'établissement et de développement",
    prefixes: ['201', '203'],
  },
  {
    // 2054 folds this into "Autres postes d'immobilisations incorporelles" (no dedicated row);
    // 2055 gives it its own row. Row-assembly, not category resolution, is where this is handled —
    // see tableau-2054.ts's ROWS_2054.
    code: 'FONDS_COMMERCIAL',
    label2054: "Autres postes d'immobilisations incorporelles",
    label2055: 'Fonds commercial',
    prefixes: ['207'],
  },
  {
    code: 'AUTRES_INCORPORELLES',
    label2054: "Autres postes d'immobilisations incorporelles",
    label2055: 'Autres immobilisations incorporelles',
    prefixes: ['205', '206', '208', '232', '237'],
  },
  {
    code: 'TERRAINS',
    label2054: 'Terrains',
    label2055: 'Terrains',
    prefixes: ['211', '212'],
  },
  {
    // Checked before the bare-213 fallback below — longest-prefix-match means a company that
    // actually creates a 2135-coded account gets routed here instead of the default.
    code: 'CONSTRUCTIONS_INST_GENERALES',
    label2054:
      'Constructions — installations générales, agencements, aménagements des constructions',
    label2055:
      'Constructions — installations générales, agencements, aménagements des constructions',
    prefixes: ['2135'],
  },
  {
    code: 'CONSTRUCTIONS_SOL_AUTRUI',
    label2054: "Constructions — sur sol d'autrui",
    label2055: "Constructions — sur sol d'autrui",
    prefixes: ['214'],
  },
  {
    // The documented default: a bare 213 account (this app's seed only ever has the bare parent —
    // no 2131/2135 split) lands here, "sur sol propre", the common/default case — see
    // specs/liasse-2054-2055-implementation-spec.md §3c. A company that creates a specific 2135
    // account is routed to CONSTRUCTIONS_INST_GENERALES above instead, via longest-prefix-match, not
    // this fallback — the default only applies when no more specific sub-account exists.
    code: 'CONSTRUCTIONS_SOL_PROPRE',
    label2054: 'Constructions — sur sol propre',
    label2055: 'Constructions — sur sol propre',
    prefixes: ['213'],
  },
  {
    code: 'INSTALLATIONS_TECHNIQUES',
    label2054: 'Installations techniques, matériel et outillage industriels',
    label2055: 'Installations techniques, matériel et outillage industriels',
    prefixes: ['215'],
  },
  {
    code: 'AUTRES_CORP_INST_GENERALES',
    label2054:
      'Autres immo. corporelles — installations générales, agencements, aménagements divers',
    label2055:
      'Autres immo. corporelles — installations générales, agencements, aménagements divers',
    prefixes: ['2181'],
  },
  {
    code: 'AUTRES_CORP_MATERIEL_TRANSPORT',
    label2054: 'Autres immo. corporelles — matériel de transport',
    label2055: 'Autres immo. corporelles — matériel de transport',
    prefixes: ['2182'],
  },
  {
    code: 'AUTRES_CORP_MATERIEL_BUREAU',
    label2054: 'Autres immo. corporelles — matériel de bureau et mobilier informatique',
    label2055: 'Autres immo. corporelles — matériel de bureau et informatique, mobilier',
    prefixes: ['2183', '2184'],
  },
  {
    code: 'AUTRES_CORP_EMBALLAGES',
    label2054: 'Autres immo. corporelles — emballages récupérables et divers',
    label2055: 'Autres immo. corporelles — emballages récupérables et divers',
    prefixes: ['2186'],
  },
  {
    // 2054 only — an asset "en cours" isn't depreciated yet, so it has no 2055 row.
    code: 'IMMOS_CORP_EN_COURS',
    label2054: 'Immobilisations corporelles en cours',
    label2055: '',
    prefixes: ['231'],
  },
  {
    code: 'AVANCES_ACOMPTES',
    label2054: 'Avances et acomptes',
    label2055: '',
    prefixes: ['238'],
  },
  {
    code: 'AUTRES_PARTICIPATIONS',
    label2054: 'Autres participations',
    label2055: '',
    prefixes: ['261', '266'],
  },
  {
    code: 'AUTRES_TITRES_IMMOBILISES',
    label2054: 'Autres titres immobilisés',
    label2055: '',
    prefixes: ['271', '272', '273'],
  },
  {
    code: 'PRETS_AUTRES_IMMO_FINANCIERES',
    label2054: 'Prêts et autres immobilisations financières',
    label2055: '',
    prefixes: ['274', '275', '276', '277'],
  },
];

/**
 * Longest-matching-prefix wins — this is what makes a specific
 * sub-account (e.g. a company-created "213500") route to the finer
 * category instead of the documented bare-213 default, without needing
 * the rule list's ordering to be load-bearing. Throws rather than
 * guessing for an account with no match at all — no bare-218 fallback
 * exists, deliberately: the form itself has no "autres, non ventilé"
 * row for corporelles the way it does for incorporelles (208) or
 * constructions (213), so an unrecognized 218-family sub-account
 * genuinely has no home on this form yet.
 */
export function resolveImmobilisationCategory(accountNumber: string): ImmobilisationCategory {
  let best: { category: ImmobilisationCategory; prefixLength: number } | null = null;
  for (const category of IMMOBILISATION_CATEGORIES) {
    for (const prefix of category.prefixes) {
      if (accountNumber.startsWith(prefix) && (!best || prefix.length > best.prefixLength)) {
        best = { category, prefixLength: prefix.length };
      }
    }
  }
  if (!best) {
    throw new BadRequestException(
      `Account "${accountNumber}" has no 2054/2055 immobilisation category mapping — see ` +
        'specs/liasse-2054-2055-implementation-spec.md §3c/§3d.',
    );
  }
  return best.category;
}
