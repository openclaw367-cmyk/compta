import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { Bilan2050 } from './bilan-2050';

/**
 * 2057-SD (État des échéances des créances et des dettes) — see
 * specs/liasse-2056-2059-implementation-spec.md §3 for why the form's
 * own échéance (maturity) split — à 1 an au plus / à plus d'1 an for
 * créances, a three-way ≤1an/1-5ans/>5ans plus an origin-based split
 * for dettes — is genuinely blocked: `EcritureLigne` has no due-date
 * field of any kind, and nothing here should guess one.
 *
 * What IS built: the form's own "MONTANT BRUT" column, per nature line,
 * reduced to the granularity the chart of accounts already cleanly
 * supports. Rather than re-classifying raw ledger accounts a third time
 * (bilan-2050.ts already does this once), this is a pure REGROUPING of
 * the already-computed Bilan2050 — every 2057 row is exactly one bilan
 * actif/passif line, relabeled. This is a real simplification from the
 * CERFA form's own finer subdivisions: some 2057 lines the form prints
 * separately (clients douteux vs. autres créances clients; personnel /
 * sécurité sociale / impôts sur les bénéfices / TVA / autres impôts,
 * shown separately on both cadres) are NOT separable from the current
 * chart, because bilan-2050.ts already merges them into one line each
 * (BX, DY) — and some (groupe et associés) are merged further still, by
 * DualNatureRule, into BZ/EA/DY alongside unrelated dual-nature
 * families (428/438/448, 458/467/468). Splitting these would mean
 * re-deriving new account-prefix rules with no more information than
 * bilan-2050.ts already has — not a mapping problem the account
 * numbers can solve, so not attempted. Every row below states the
 * bilan line it reproduces.
 */

export interface Tableau2057Ligne {
  code: string;
  label: string;
  montantBrut: string;
}

export interface Tableau2057 {
  cadreA: Tableau2057Ligne[];
  /** Sum of Cadre A montants bruts. */
  totalCreances: string;
  cadreB: Tableau2057Ligne[];
  /** Sum of Cadre B montants bruts. */
  totalDettes: string;
  note: string;
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

const NOTE =
  "L'échéance (à un an au plus / à plus d'un an pour les créances ; échéancier à un, cinq ans et " +
  "plus pour les dettes) n'est pas renseignée : aucune date d'échéance n'est enregistrée sur les " +
  "lignes d'écriture dans cette application. Seul le montant brut par nature est calculé.";

export function computeTableau2057(bilan: Bilan2050): Tableau2057 {
  const actifByCode = new Map(bilan.actif.map((l) => [l.code, l]));
  const passifByCode = new Map(bilan.passif.map((l) => [l.code, l]));

  const cadreA: Tableau2057Ligne[] = CADRE_A_ROWS.map(({ code, label }) => {
    const ligne = actifByCode.get(code);
    if (!ligne) {
      throw new ConflictException(
        `Bilan2050.actif has no line "${code}" — computeBilan2050() should always produce every ` +
          'ACTIF_ROWS line, even at 0,00. This is a bilan mapping bug, not a 2057 problem.',
      );
    }
    return { code, label, montantBrut: ligne.brut };
  });

  const cadreB: Tableau2057Ligne[] = CADRE_B_ROWS.map(({ code, label }) => {
    const ligne = passifByCode.get(code);
    if (!ligne) {
      throw new ConflictException(
        `Bilan2050.passif has no line "${code}" — computeBilan2050() should always produce every ` +
          'PASSIF_RULES line, even at 0,00. This is a bilan mapping bug, not a 2057 problem.',
      );
    }
    return { code, label, montantBrut: ligne.montant };
  });

  const sumBrut = (lignes: Tableau2057Ligne[]) =>
    lignes
      .reduce((sum, l) => sum.plus(Money.fromString(l.montantBrut)), Money.zero())
      .toApiString();

  return {
    cadreA,
    totalCreances: sumBrut(cadreA),
    cadreB,
    totalDettes: sumBrut(cadreB),
    note: NOTE,
  };
}
