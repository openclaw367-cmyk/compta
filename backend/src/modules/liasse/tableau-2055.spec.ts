import { Money } from '../../common/decimal';
import { computeTableau2055 } from './tableau-2055';
import {
  FY_2026,
  LATER_DEPRECIATION_ENTRY,
  ORACLE_DEPRECIATION_ENTRIES,
} from './tableau-2054-2055-oracle-fixture';

function ligne(result: ReturnType<typeof computeTableau2055>, code: string) {
  const l = result.lignes.find((x) => x.code === code);
  if (!l) throw new Error(`No 2055 row ${code}`);
  return l;
}

describe('computeTableau2055', () => {
  it('matches the hand-computed multi-asset, multi-year oracle — début vs dotations split correct', () => {
    // Hand-computed (see tableau-2054-2055-oracle-fixture.ts):
    //   Bâtiment B (213000): FY2025 dotation 10000 -> début; FY2026 dotation 10000 -> dotations; fin=20000
    //   Machine D (215400): début=3000, dotations=3000, fin=6000
    //   Véhicule F (218200): début=6000, dotations=6000, fin=12000
    //   Ordinateurs E (218300, acquired this year): début=0 (didn't exist in FY2025), dotations=600, fin=600
    //   Terrain A / Entrepôt C: never depreciated -> 0/0/0
    //   Total fin = 20000+6000+12000+600 = 38600.00
    const result = computeTableau2055(ORACLE_DEPRECIATION_ENTRIES, FY_2026);

    expect(ligne(result, 'TERRAINS')).toMatchObject({
      montantDebut: '0.00',
      dotations: '0.00',
      montantFin: '0.00',
    });
    expect(ligne(result, 'CONSTRUCTIONS_SOL_PROPRE')).toMatchObject({
      montantDebut: '10000.00',
      dotations: '10000.00',
      montantFin: '20000.00',
    });
    expect(ligne(result, 'CONSTRUCTIONS_SOL_AUTRUI')).toMatchObject({
      montantDebut: '0.00',
      dotations: '0.00',
      montantFin: '0.00',
    });
    expect(ligne(result, 'INSTALLATIONS_TECHNIQUES')).toMatchObject({
      montantDebut: '3000.00',
      dotations: '3000.00',
      montantFin: '6000.00',
    });
    expect(ligne(result, 'AUTRES_CORP_MATERIEL_TRANSPORT')).toMatchObject({
      montantDebut: '6000.00',
      dotations: '6000.00',
      montantFin: '12000.00',
    });
    expect(ligne(result, 'AUTRES_CORP_MATERIEL_BUREAU')).toMatchObject({
      montantDebut: '0.00',
      dotations: '600.00',
      montantFin: '600.00',
    });

    // No disposals in this fixture — every row's diminutions is 0.00.
    for (const l of result.lignes) {
      expect(l.diminutions).toBe('0.00');
    }

    expect(result.totalIncorporelles).toBe('0.00');
    expect(result.totalCorporelles).toBe('38600.00');
    expect(result.totalGeneral).toBe('38600.00');
  });

  it('refuses a depreciation entry belonging to a fiscal year after the reported one ends', () => {
    expect(() =>
      computeTableau2055([...ORACLE_DEPRECIATION_ENTRIES, LATER_DEPRECIATION_ENTRY], FY_2026),
    ).toThrow(/after the reported fiscal year ends/);
  });

  it('a disposal within the reported year reduces fin via the diminutions column, without touching début/dotations', () => {
    const result = computeTableau2055(ORACLE_DEPRECIATION_ENTRIES, FY_2026, [
      { accountNumber: '215400', amortissementsCumules: Money.fromString('6000.00') },
    ]);
    expect(ligne(result, 'INSTALLATIONS_TECHNIQUES')).toMatchObject({
      montantDebut: '3000.00',
      dotations: '3000.00',
      diminutions: '6000.00',
      montantFin: '0.00',
    });
    // Total général drops by exactly the disposed asset's cumulative amortissements.
    expect(result.totalGeneral).toBe('32600.00'); // 38600.00 - 6000.00
  });

  it('accumulates diminutions across multiple disposals in the same category', () => {
    const result = computeTableau2055(ORACLE_DEPRECIATION_ENTRIES, FY_2026, [
      { accountNumber: '218200', amortissementsCumules: Money.fromString('5000.00') },
      { accountNumber: '218300', amortissementsCumules: Money.fromString('600.00') },
    ]);
    expect(ligne(result, 'AUTRES_CORP_MATERIEL_TRANSPORT').diminutions).toBe('5000.00');
    expect(ligne(result, 'AUTRES_CORP_MATERIEL_BUREAU').diminutions).toBe('600.00');
  });
});
