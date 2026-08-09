import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { PROVISION_CATEGORIES, resolveProvisionCategory } from './provision-categories';

/**
 * 2056-SD (Provisions inscrites au bilan) — see
 * specs/liasse-2056-2059-implementation-spec.md §2/§3.
 *
 * A movement table like 2054/2055, but sourced differently: there is no
 * dedicated `Provision`/`ProvisionMovement` domain model (unlike
 * FixedAsset/DepreciationEntry for immobilisations), so "début" and
 * "dotations"/"reprises" are derived directly from the ledger by
 * journal: à-nouveau posts each account's opening balance into the
 * fiscal year's own ledger (see a-nouveau.service.ts), so a line whose
 * écriture's journal has type A_NOUVEAU IS that account's "début" for
 * this year, and every other line is within-year movement — credit
 * lines are dotations, debit lines are reprises (never netted against
 * each other, unlike a plain trial balance).
 *
 * The "Dont dotations et reprises : d'exploitation / financières /
 * exceptionnelles" memo split (form's UE-UK) is NOT computed — it
 * requires knowing each movement's COUNTERPART account (was the
 * matching 681x/781x debit/credit exploitation, 686x/786x financière,
 * or 687x/787x exceptionnelle?), which means grouping by écriture, not
 * just aggregating flat ligne totals the way every other line in this
 * module does. That's a different query shape than the rest of the
 * liasse engine and is deferred, not guessed — see the null field below.
 */

export interface ProvisionMovementLigne {
  accountNumber: string;
  /** True when this ligne's écriture was posted through the à-nouveau journal (type A_NOUVEAU) — i.e. it IS the year's opening balance, not in-year movement. */
  isOpeningBalance: boolean;
  debit: Money;
  credit: Money;
}

export interface Tableau2056Ligne {
  code: string;
  label: string;
  montantDebut: string;
  dotations: string;
  reprises: string;
  montantFin: string;
}

export interface Tableau2056 {
  lignes: Tableau2056Ligne[];
  /** TOTAL I (fin) — provisions réglementées. */
  totalReglementees: string;
  /** TOTAL II (fin) — provisions pour risques et charges. */
  totalRisquesCharges: string;
  /** TOTAL III (fin) — provisions pour dépréciation. */
  totalDepreciation: string;
  /** TOTAL GÉNÉRAL (I+II+III), fin. */
  totalGeneral: string;
  /** UE/UF, UG/UH, UJ/UK — dont dotations/reprises d'exploitation/financières/exceptionnelles. Not computed this pass, see module doc comment. */
  dontDotationsReprisesParNature: null;
}

const TOTAL_I_CODES = [
  'RECONSTITUTION_GISEMENTS',
  'INVESTISSEMENT',
  'HAUSSE_PRIX',
  'AMORTISSEMENTS_DEROGATOIRES',
  'AUTRES_REGLEMENTEES',
];
const TOTAL_II_CODES = [
  'LITIGES',
  'GARANTIES_CLIENTS',
  'AMENDES_PENALITES',
  'PERTES_CHANGE',
  'PENSIONS',
  'IMPOTS',
  'RENOUVELLEMENT_IMMOBILISATIONS',
  'GROS_ENTRETIEN',
  'AUTRES_RISQUES_CHARGES',
];
const TOTAL_III_CODES = [
  'DEPREC_INCORPORELLES',
  'DEPREC_CORPORELLES',
  'DEPREC_TITRES_PARTICIPATION',
  'DEPREC_AUTRES_IMMO_FINANCIERES',
  'DEPREC_STOCKS_EN_COURS',
  'DEPREC_COMPTES_CLIENTS',
  'DEPREC_AUTRES',
];

/**
 * Pure computation, no I/O. `lignes` must already be pre-filtered by the
 * caller to provision/dépréciation accounts only (see
 * PROVISION_ACCOUNT_CLASS_PREFIXES) — an account this module doesn't
 * recognize throws via resolveProvisionCategory rather than being
 * silently dropped.
 */
export function computeTableau2056(lignes: ProvisionMovementLigne[]): Tableau2056 {
  const byCategory = new Map<string, { debut: Money; dotations: Money; reprises: Money }>();
  for (const ligne of lignes) {
    const category = resolveProvisionCategory(ligne.accountNumber);
    const bucket = byCategory.get(category.code) ?? {
      debut: Money.zero(),
      dotations: Money.zero(),
      reprises: Money.zero(),
    };
    if (ligne.isOpeningBalance) {
      bucket.debut = bucket.debut.plus(ligne.credit).minus(ligne.debit);
    } else {
      bucket.dotations = bucket.dotations.plus(ligne.credit);
      bucket.reprises = bucket.reprises.plus(ligne.debit);
    }
    byCategory.set(category.code, bucket);
  }

  const lignesOut: Tableau2056Ligne[] = PROVISION_CATEGORIES.map((category) => {
    const bucket = byCategory.get(category.code) ?? {
      debut: Money.zero(),
      dotations: Money.zero(),
      reprises: Money.zero(),
    };
    const fin = bucket.debut.plus(bucket.dotations).minus(bucket.reprises);
    if (fin.isNegative()) {
      throw new ConflictException(
        `Ligne ${category.code} (${category.label}) computed a closing balance of ` +
          `${fin.toApiString()}, which is negative — a provision/dépréciation account should never ` +
          'net to a debit balance. This usually means a reprise exceeded what was ever provisioned.',
      );
    }
    return {
      code: category.code,
      label: category.label,
      montantDebut: bucket.debut.toApiString(),
      dotations: bucket.dotations.toApiString(),
      reprises: bucket.reprises.toApiString(),
      montantFin: fin.toApiString(),
    };
  });

  const sumFin = (codes: string[]) =>
    lignesOut
      .filter((l) => codes.includes(l.code))
      .reduce((sum, l) => sum.plus(Money.fromString(l.montantFin)), Money.zero());

  return {
    lignes: lignesOut,
    totalReglementees: sumFin(TOTAL_I_CODES).toApiString(),
    totalRisquesCharges: sumFin(TOTAL_II_CODES).toApiString(),
    totalDepreciation: sumFin(TOTAL_III_CODES).toApiString(),
    totalGeneral: sumFin([...TOTAL_I_CODES, ...TOTAL_II_CODES, ...TOTAL_III_CODES]).toApiString(),
    dontDotationsReprisesParNature: null,
  };
}
