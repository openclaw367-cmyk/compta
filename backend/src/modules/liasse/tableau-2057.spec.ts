import { Money } from '../../common/decimal';
import { computeBilan2050 } from './bilan-2050';
import { buildTrialBalance } from './trial-balance-engine';
import { ORACLE_BILAN_LIGNES, ORACLE_HN } from './liasse-oracle-fixture';
import { computeTableau2057 } from './tableau-2057';

describe('computeTableau2057', () => {
  it('matches the hand-traced oracle: reproduces bilan BX/DX/DY/DZ/DU as Cadre A/B rows, everything else 0,00', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const tableau2057 = computeTableau2057(bilan);

    const byCodeA = new Map(tableau2057.cadreA.map((l) => [l.code, l.montantBrut]));
    // T9/T10: 411000 net debit 15 000,00 (36 000 vente − 21 000 encaissé).
    expect(byCodeA.get('BX')).toBe('15000.00');
    expect(byCodeA.get('BB')).toBe('0.00');
    expect(byCodeA.get('BF')).toBe('0.00');
    expect(byCodeA.get('BH')).toBe('0.00');
    expect(byCodeA.get('BV')).toBe('0.00');
    expect(byCodeA.get('BZ')).toBe('0.00');
    expect(byCodeA.get('CH')).toBe('0.00');
    expect(tableau2057.totalCreances).toBe('15000.00');

    const byCodeB = new Map(tableau2057.cadreB.map((l) => [l.code, l.montantBrut]));
    // T2: 164000 emprunt bancaire 40 000,00 + T23: 514000 overdraft 3 000,00 (dual-nature) → DU.
    expect(byCodeB.get('DU')).toBe('43000.00');
    // T7/T8/T11/T23: 401000 net credit 7 000,00 (27 000 achats − 20 000 réglé).
    expect(byCodeB.get('DX')).toBe('7000.00');
    // T13 (431 sécu 6 000) + T18 (444 impôts bénéfices 4 000) + T9 (445710 TVA 6 000) + T22 (428 dual 1 000).
    expect(byCodeB.get('DY')).toBe('17000.00');
    // T4: 404000 (dettes sur immobilisations) 40 000,00.
    expect(byCodeB.get('DZ')).toBe('40000.00');
    expect(byCodeB.get('DS')).toBe('0.00');
    expect(byCodeB.get('DT')).toBe('0.00');
    expect(byCodeB.get('DV')).toBe('0.00');
    expect(byCodeB.get('DW')).toBe('0.00');
    expect(byCodeB.get('EA')).toBe('0.00');
    expect(byCodeB.get('EB')).toBe('0.00');
    expect(tableau2057.totalDettes).toBe('107000.00');
  });

  it('every Cadre A/B row is present even when 0,00 — no line silently omitted', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const tableau2057 = computeTableau2057(bilan);
    expect(tableau2057.cadreA).toHaveLength(7);
    expect(tableau2057.cadreB).toHaveLength(10);
  });

  it('states the maturity-split gap explicitly rather than a silent omission', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const tableau2057 = computeTableau2057(bilan);
    expect(tableau2057.note).toMatch(/aucune date d'échéance/);
  });
});
