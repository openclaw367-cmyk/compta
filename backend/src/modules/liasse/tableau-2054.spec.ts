import { computeTableau2054 } from './tableau-2054';
import { FY_2026, LATER_ASSET, ORACLE_ASSETS } from './tableau-2054-2055-oracle-fixture';

function ligne(result: ReturnType<typeof computeTableau2054>, code: string) {
  const l = result.lignes.find((x) => x.code === code);
  if (!l) throw new Error(`No 2054 row ${code}`);
  return l;
}

describe('computeTableau2054', () => {
  it('matches the hand-computed multi-asset, multi-year oracle — début vs acquisitions split correct', () => {
    // Hand-computed (see tableau-2054-2055-oracle-fixture.ts):
    //   Terrain A (211000, acquired 2025-03-01, before FY2026 starts) -> TERRAINS début=50000, acquisitions=0
    //   Bâtiment B (213000 bare -> sur sol propre, acquired 2025-06-01) -> début=200000, acquisitions=0
    //   Entrepôt C (214000 -> sur sol d'autrui, acquired 2026-04-01, WITHIN FY2026) -> début=0, acquisitions=80000
    //   Machine D (215400, acquired 2025-09-01) -> début=30000, acquisitions=0
    //   Ordinateurs E (218300 -> matériel bureau, acquired 2026-02-01, within FY2026) -> début=0, acquisitions=6000
    //   Véhicule F (218200 -> matériel transport, acquired 2025-01-10) -> début=24000, acquisitions=0
    //   Total fin (corporelles, no incorporelles/financières in this fixture) = 390000.00
    const result = computeTableau2054(ORACLE_ASSETS, FY_2026);

    expect(ligne(result, 'TERRAINS')).toMatchObject({
      valeurBruteDebut: '50000.00',
      acquisitions: '0.00',
      valeurBruteFin: '50000.00',
    });
    expect(ligne(result, 'CONSTRUCTIONS_SOL_PROPRE')).toMatchObject({
      valeurBruteDebut: '200000.00',
      acquisitions: '0.00',
      valeurBruteFin: '200000.00',
    });
    expect(ligne(result, 'CONSTRUCTIONS_SOL_AUTRUI')).toMatchObject({
      valeurBruteDebut: '0.00',
      acquisitions: '80000.00',
      valeurBruteFin: '80000.00',
    });
    expect(ligne(result, 'INSTALLATIONS_TECHNIQUES')).toMatchObject({
      valeurBruteDebut: '30000.00',
      acquisitions: '0.00',
      valeurBruteFin: '30000.00',
    });
    expect(ligne(result, 'AUTRES_CORP_MATERIEL_TRANSPORT')).toMatchObject({
      valeurBruteDebut: '24000.00',
      acquisitions: '0.00',
      valeurBruteFin: '24000.00',
    });
    expect(ligne(result, 'AUTRES_CORP_MATERIEL_BUREAU')).toMatchObject({
      valeurBruteDebut: '0.00',
      acquisitions: '6000.00',
      valeurBruteFin: '6000.00',
    });

    // No disposals in this fixture — every row's cessions is 0.00 (virements stays a real gap,
    // FixedAsset has no reclassify endpoint).
    for (const l of result.lignes) {
      expect(l.cessions).toBe('0.00');
      expect(l.virements).toBe('0.00');
    }
    // Untouched rows are all zero, not omitted.
    for (const code of [
      'FRAIS_ETABLISSEMENT_DEV',
      'AUTRES_POSTES_INCORPORELLES',
      'CONSTRUCTIONS_INST_GENERALES',
      'AUTRES_CORP_INST_GENERALES',
      'AUTRES_CORP_EMBALLAGES',
      'IMMOS_CORP_EN_COURS',
      'AVANCES_ACOMPTES',
      'AUTRES_PARTICIPATIONS',
      'AUTRES_TITRES_IMMOBILISES',
      'PRETS_AUTRES_IMMO_FINANCIERES',
    ]) {
      expect(ligne(result, code)).toMatchObject({
        valeurBruteDebut: '0.00',
        acquisitions: '0.00',
        valeurBruteFin: '0.00',
      });
    }

    expect(result.totalIncorporelles).toBe('0.00');
    expect(result.totalFinancieres).toBe('0.00');
    expect(result.totalCorporelles).toBe('390000.00');
    expect(result.totalGeneral).toBe('390000.00');
  });

  it('routes a bare 213 account to "sur sol propre" and a specific 214/2135 account to their own rows (the granularity decision, exercised end to end)', () => {
    const result = computeTableau2054(ORACLE_ASSETS, FY_2026);
    // Bâtiment B (bare 213000) landed on CONSTRUCTIONS_SOL_PROPRE, not CONSTRUCTIONS_SOL_AUTRUI or
    // CONSTRUCTIONS_INST_GENERALES — already asserted above; this test just makes the intent explicit.
    expect(ligne(result, 'CONSTRUCTIONS_SOL_PROPRE').valeurBruteFin).toBe('200000.00');
    expect(ligne(result, 'CONSTRUCTIONS_INST_GENERALES').valeurBruteFin).toBe('0.00');
  });

  it('refuses an asset acquired after the reported fiscal year ends — must be excluded by the caller, not silently misdated', () => {
    expect(() => computeTableau2054([...ORACLE_ASSETS, LATER_ASSET], FY_2026)).toThrow(
      /after the reported fiscal year ends/,
    );
  });

  it('a disposal WITHIN the reported year reduces fin via the cessions column, without touching début', () => {
    const disposed = ORACLE_ASSETS.map((a) =>
      a.accountNumber === '215400' ? { ...a, cessionDate: new Date('2026-07-01') } : a,
    );
    const result = computeTableau2054(disposed, FY_2026);
    expect(ligne(result, 'INSTALLATIONS_TECHNIQUES')).toMatchObject({
      valeurBruteDebut: '30000.00',
      acquisitions: '0.00',
      cessions: '30000.00',
      valeurBruteFin: '0.00',
    });
    // Total général drops by exactly the disposed asset's valeurBrute.
    expect(result.totalGeneral).toBe('360000.00'); // 390000.00 - 30000.00
  });

  it('an asset disposed in a STRICTLY EARLIER fiscal year is excluded entirely — no contribution to début', () => {
    const disposedLastYear = ORACLE_ASSETS.map((a) =>
      a.accountNumber === '215400' ? { ...a, cessionDate: new Date('2025-11-01') } : a,
    );
    const result = computeTableau2054(disposedLastYear, FY_2026);
    expect(ligne(result, 'INSTALLATIONS_TECHNIQUES')).toMatchObject({
      valeurBruteDebut: '0.00',
      acquisitions: '0.00',
      cessions: '0.00',
      valeurBruteFin: '0.00',
    });
  });
});
