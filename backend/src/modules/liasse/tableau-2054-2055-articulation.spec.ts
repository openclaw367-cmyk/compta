import { Money } from '../../common/decimal';
import { buildTrialBalance } from './trial-balance-engine';
import { computeBilan2050 } from './bilan-2050';
import { computeCompteResultat2052_2053 } from './compte-resultat-2052-2053';
import { computeTableau2054 } from './tableau-2054';
import { computeTableau2055 } from './tableau-2055';
import { assertTableauxTieToBilan } from './liasse-articulation';
import {
  FY_2026,
  ORACLE_ASSETS,
  ORACLE_BILAN_LIGNES,
  ORACLE_DEPRECIATION_ENTRIES,
  ORACLE_HN,
} from './tableau-2054-2055-oracle-fixture';

describe('assertTableauxTieToBilan', () => {
  it('ties 2054 − 2055 to the bilan on the same multi-year oracle — the annexe version of Actif=Passif', () => {
    // Hand-computed (see tableau-2054-2055-oracle-fixture.ts):
    //   Bilan AN (Terrains) = 50000.00 brut/net (no amort)
    //   Bilan AP (Constructions, 213+214 combined) = 200000+80000 = 280000.00 brut; amort (2813-prefixed
    //     only, 214 untouched) = 20000.00; net = 260000.00
    //   Bilan AR (Installations techniques, 215) = 30000.00 brut; amort = 6000.00; net = 24000.00
    //   Bilan AT (Autres corp, 218200+218300 combined) = 24000+6000=30000.00 brut; amort
    //     (2818-prefixed, both share it) = 12000+600=12600.00; net = 17400.00
    //   Total immobilisations net = 50000+260000+24000+17400 = 351400.00
    //
    //   2054 total général (fin) = 390000.00 (see tableau-2054.spec.ts)
    //   2055 total général (fin) = 38600.00 (see tableau-2055.spec.ts)
    //   2054 - 2055 = 351400.00 — matches the bilan figure above exactly.
    const bilanAccounts = buildTrialBalance(ORACLE_BILAN_LIGNES).filter(
      (a) => a.pcgClass >= 1 && a.pcgClass <= 5,
    );
    const cdrAccounts = buildTrialBalance(ORACLE_BILAN_LIGNES).filter(
      (a) => a.pcgClass === 6 || a.pcgClass === 7,
    );
    const compteResultat = computeCompteResultat2052_2053(cdrAccounts);
    expect(compteResultat.beneficeOuPerte).toBe(ORACLE_HN);
    const bilan = computeBilan2050(bilanAccounts, Money.fromString(compteResultat.beneficeOuPerte));

    // Sanity: the bilan itself balances and shows the expected immobilisation lines before we even
    // get to the 2054/2055 tie-out.
    expect(bilan.actif.find((l) => l.code === 'AN')).toMatchObject({
      brut: '50000.00',
      net: '50000.00',
    });
    expect(bilan.actif.find((l) => l.code === 'AP')).toMatchObject({
      brut: '280000.00',
      amortissements: '20000.00',
      net: '260000.00',
    });
    expect(bilan.actif.find((l) => l.code === 'AR')).toMatchObject({
      brut: '30000.00',
      amortissements: '6000.00',
      net: '24000.00',
    });
    expect(bilan.actif.find((l) => l.code === 'AT')).toMatchObject({
      brut: '30000.00',
      amortissements: '12600.00',
      net: '17400.00',
    });
    expect(bilan.totalActifNet).toBe(bilan.totalPassif);

    const tableau2054 = computeTableau2054(ORACLE_ASSETS, FY_2026);
    const tableau2055 = computeTableau2055(ORACLE_DEPRECIATION_ENTRIES, FY_2026);
    expect(tableau2054.totalGeneral).toBe('390000.00');
    expect(tableau2055.totalGeneral).toBe('38600.00');

    expect(() => assertTableauxTieToBilan({ bilan, tableau2054, tableau2055 })).not.toThrow();
  });

  it('throws when 2054/2055 and the bilan disagree', () => {
    const bilanAccounts = buildTrialBalance(ORACLE_BILAN_LIGNES).filter(
      (a) => a.pcgClass >= 1 && a.pcgClass <= 5,
    );
    const cdrAccounts = buildTrialBalance(ORACLE_BILAN_LIGNES).filter(
      (a) => a.pcgClass === 6 || a.pcgClass === 7,
    );
    const compteResultat = computeCompteResultat2052_2053(cdrAccounts);
    const bilan = computeBilan2050(bilanAccounts, Money.fromString(compteResultat.beneficeOuPerte));

    const tableau2054 = computeTableau2054(ORACLE_ASSETS, FY_2026);
    const wrongTableau2055 = {
      ...computeTableau2055(ORACLE_DEPRECIATION_ENTRIES, FY_2026),
      totalGeneral: '999.00',
    };

    expect(() =>
      assertTableauxTieToBilan({ bilan, tableau2054, tableau2055: wrongTableau2055 }),
    ).toThrow(/does not equal the bilan's total immobilisations net/);
  });
});
