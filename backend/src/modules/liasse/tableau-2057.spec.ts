import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import { computeBilan2050 } from './bilan-2050';
import { buildTrialBalance } from './trial-balance-engine';
import { ORACLE_BILAN_LIGNES, ORACLE_HN } from './liasse-oracle-fixture';
import { Tableau2057RawLigne, computeTableau2057 } from './tableau-2057';

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

const FISCAL_YEAR_END = new Date('2026-12-31');

describe('computeTableau2057', () => {
  it('matches the hand-traced oracle: reproduces bilan BX/DX/DY/DZ/DU as Cadre A/B rows, everything else 0,00', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    // No line in this fixture carries a dateEcheance — every créance/dette line falls into the
    // default short-term bucket, so aUnAnAuPlus === montantBrut for every populated row.
    const rawLignes: Tableau2057RawLigne[] = ORACLE_BILAN_LIGNES.map((l) => ({
      compteNumber: l.compteNumber,
      pcgClass: l.pcgClass,
      debit: l.debit,
      credit: l.credit,
      dateEcheance: null,
    }));
    const tableau2057 = computeTableau2057(bilan, rawLignes, FISCAL_YEAR_END);

    const byCodeA = new Map(tableau2057.cadreA.map((l) => [l.code, l]));
    // T9/T10: 411000 net debit 15 000,00 (36 000 vente − 21 000 encaissé).
    expect(byCodeA.get('BX')).toMatchObject({
      montantBrut: '15000.00',
      aUnAnAuPlus: '15000.00',
      aPlusDUnAn: '0.00',
    });
    expect(byCodeA.get('BB')?.montantBrut).toBe('0.00');
    expect(byCodeA.get('BF')?.montantBrut).toBe('0.00');
    expect(byCodeA.get('BH')?.montantBrut).toBe('0.00');
    expect(byCodeA.get('BV')?.montantBrut).toBe('0.00');
    expect(byCodeA.get('BZ')?.montantBrut).toBe('0.00');
    expect(byCodeA.get('CH')?.montantBrut).toBe('0.00');
    expect(tableau2057.totalCreances).toBe('15000.00');

    const byCodeB = new Map(tableau2057.cadreB.map((l) => [l.code, l]));
    // T2: 164000 emprunt bancaire 40 000,00 + T23: 514000 overdraft 3 000,00 (dual-nature) → DU.
    expect(byCodeB.get('DU')).toMatchObject({
      montantBrut: '43000.00',
      aUnAnAuPlus: '43000.00',
      aPlusDUnAnEt5AnsAuPlus: '0.00',
      aPlusDe5Ans: '0.00',
    });
    // T7/T8/T11/T23: 401000 net credit 7 000,00 (27 000 achats − 20 000 réglé).
    expect(byCodeB.get('DX')?.montantBrut).toBe('7000.00');
    // T13 (431 sécu 6 000) + T18 (444 impôts bénéfices 4 000) + T9 (445710 TVA 6 000) + T22 (428 dual 1 000).
    expect(byCodeB.get('DY')?.montantBrut).toBe('17000.00');
    // T4: 404000 (dettes sur immobilisations) 40 000,00.
    expect(byCodeB.get('DZ')?.montantBrut).toBe('40000.00');
    expect(byCodeB.get('DS')?.montantBrut).toBe('0.00');
    expect(byCodeB.get('DT')?.montantBrut).toBe('0.00');
    expect(byCodeB.get('DV')?.montantBrut).toBe('0.00');
    expect(byCodeB.get('DW')?.montantBrut).toBe('0.00');
    expect(byCodeB.get('EA')?.montantBrut).toBe('0.00');
    expect(byCodeB.get('EB')?.montantBrut).toBe('0.00');
    expect(tableau2057.totalDettes).toBe('107000.00');
  });

  it('every Cadre A/B row is present even when 0,00 — no line silently omitted', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const rawLignes: Tableau2057RawLigne[] = ORACLE_BILAN_LIGNES.map((l) => ({
      compteNumber: l.compteNumber,
      pcgClass: l.pcgClass,
      debit: l.debit,
      credit: l.credit,
      dateEcheance: null,
    }));
    const tableau2057 = computeTableau2057(bilan, rawLignes, FISCAL_YEAR_END);
    expect(tableau2057.cadreA).toHaveLength(7);
    expect(tableau2057.cadreB).toHaveLength(10);
  });

  it('splits a créance and a dette by dateEcheance — à un an au plus vs à plus d’un an (Cadre A), and the three-way split (Cadre B)', () => {
    // Two client sales: 10 000,00 due within a year (échéance 2027-06-30, ≤ FY end + 1 an =
    // 2027-12-31 → à un an au plus), 5 000,00 due beyond that (2028-06-30 → à plus d'un an).
    const lignes = [
      {
        compteNumber: '411000',
        pcgClass: 4,
        debit: d('10000.00'),
        credit: d('0.00'),
        dateEcheance: new Date('2027-06-30'),
      },
      {
        compteNumber: '411000',
        pcgClass: 4,
        debit: d('5000.00'),
        credit: d('0.00'),
        dateEcheance: new Date('2028-06-30'),
      },
      // Three loan drawdowns: 8 000,00 due within a year, 12 000,00 due within 5 years
      // (2030-06-30 ≤ FY end + 5 ans = 2031-12-31), 3 000,00 due beyond 5 years (2035-06-30).
      {
        compteNumber: '164000',
        pcgClass: 1,
        debit: d('0.00'),
        credit: d('8000.00'),
        dateEcheance: new Date('2027-06-30'),
      },
      {
        compteNumber: '164000',
        pcgClass: 1,
        debit: d('0.00'),
        credit: d('12000.00'),
        dateEcheance: new Date('2030-06-30'),
      },
      {
        compteNumber: '164000',
        pcgClass: 1,
        debit: d('0.00'),
        credit: d('3000.00'),
        dateEcheance: new Date('2035-06-30'),
      },
    ];
    const bilan = computeBilan2050(buildTrialBalance(lignes), Money.zero());
    const tableau2057 = computeTableau2057(bilan, lignes, FISCAL_YEAR_END);

    const bx = tableau2057.cadreA.find((l) => l.code === 'BX')!;
    expect(bx).toMatchObject({
      montantBrut: '15000.00',
      aUnAnAuPlus: '10000.00',
      aPlusDUnAn: '5000.00',
    });

    const du = tableau2057.cadreB.find((l) => l.code === 'DU')!;
    expect(du).toMatchObject({
      montantBrut: '23000.00',
      aUnAnAuPlus: '8000.00',
      aPlusDUnAnEt5AnsAuPlus: '12000.00',
      aPlusDe5Ans: '3000.00',
    });
  });

  it('a line with no dateEcheance falls into the short-term default bucket, documented in maturityNote', () => {
    const lignes = [
      {
        compteNumber: '411000',
        pcgClass: 4,
        debit: d('1000.00'),
        credit: d('0.00'),
        dateEcheance: null,
      },
    ];
    const bilan = computeBilan2050(buildTrialBalance(lignes), Money.zero());
    const tableau2057 = computeTableau2057(bilan, lignes, FISCAL_YEAR_END);

    const bx = tableau2057.cadreA.find((l) => l.code === 'BX')!;
    expect(bx).toMatchObject({
      montantBrut: '1000.00',
      aUnAnAuPlus: '1000.00',
      aPlusDUnAn: '0.00',
    });
    expect(tableau2057.maturityNote).toMatch(/à un an au plus/);
    expect(tableau2057.note).toBeTruthy();
  });
});
