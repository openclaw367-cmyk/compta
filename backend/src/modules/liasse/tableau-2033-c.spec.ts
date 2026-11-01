import { Money } from '../../common/decimal';
import { computeTableau2033C } from './tableau-2033-c';
import { computeTableau2054 } from './tableau-2054';
import { computeTableau2055 } from './tableau-2055';
import {
  FY_2026,
  LATER_ASSET,
  LATER_DEPRECIATION_ENTRY,
  ORACLE_ASSETS,
  ORACLE_DEPRECIATION_ENTRIES,
} from './tableau-2054-2055-oracle-fixture';

function immobLigne(result: ReturnType<typeof computeTableau2033C>, code: string) {
  const l = result.immobilisations.lignes.find((x) => x.code === code);
  if (!l) throw new Error(`No 2033-C Cadre I row ${code}`);
  return l;
}

function amortLigne(result: ReturnType<typeof computeTableau2033C>, code: string) {
  const l = result.amortissements.lignes.find((x) => x.code === code);
  if (!l) throw new Error(`No 2033-C Cadre II row ${code}`);
  return l;
}

describe('computeTableau2033C', () => {
  it('matches the hand-computed multi-asset, multi-year oracle (same fixture as 2054/2055) — Cadre I (immobilisations)', () => {
    // Hand-computed — see tableau-2054-2055-oracle-fixture.ts and tableau-2054.spec.ts's own
    // per-category trace. 2033-C's own rows are coarser: Constructions folds
    // CONSTRUCTIONS_SOL_PROPRE (213000, Bâtiment B) + CONSTRUCTIONS_SOL_AUTRUI (214000, Entrepôt C);
    // "Autres immobilisations corporelles" folds AUTRES_CORP_MATERIEL_BUREAU (218300, Ordinateurs E).
    //   400 (Fonds commercial): 0/0/0/0
    //   410 (Autres incorp.): 0/0/0/0
    //   420 (Terrains, 211000): début=50000, fin=50000
    //   430 (Constructions, 213000+214000): début=200000 (Bâtiment B only — Entrepôt C acquired
    //        THIS year), augmentations=80000 (Entrepôt C), fin=280000
    //   440 (Installations techniques, 215400): début=30000, fin=30000
    //   450 (Installations générales): 0/0/0/0 (no 2181-prefixed asset in this fixture)
    //   460 (Matériel de transport, 218200): début=24000, fin=24000
    //   470 (Autres immo. corp., 218300): augmentations=6000, fin=6000
    //   480 (Immobilisations financières): 0/0/0/0
    //   TOTAL: début=304000, augmentations=86000, diminutions=0, fin=390000
    const result = computeTableau2033C(
      ORACLE_ASSETS,
      FY_2026,
      ORACLE_DEPRECIATION_ENTRIES,
      FY_2026,
    );

    expect(immobLigne(result, '400')).toMatchObject({
      debut: '0.00',
      augmentations: '0.00',
      diminutions: '0.00',
      fin: '0.00',
    });
    expect(immobLigne(result, '410')).toMatchObject({ fin: '0.00' });
    expect(immobLigne(result, '420')).toMatchObject({
      debut: '50000.00',
      augmentations: '0.00',
      diminutions: '0.00',
      fin: '50000.00',
    });
    expect(immobLigne(result, '430')).toMatchObject({
      debut: '200000.00',
      augmentations: '80000.00',
      diminutions: '0.00',
      fin: '280000.00',
    });
    expect(immobLigne(result, '440')).toMatchObject({
      debut: '30000.00',
      augmentations: '0.00',
      fin: '30000.00',
    });
    expect(immobLigne(result, '450')).toMatchObject({ fin: '0.00' });
    expect(immobLigne(result, '460')).toMatchObject({
      debut: '24000.00',
      augmentations: '0.00',
      fin: '24000.00',
    });
    expect(immobLigne(result, '470')).toMatchObject({
      debut: '0.00',
      augmentations: '6000.00',
      fin: '6000.00',
    });
    expect(immobLigne(result, '480')).toMatchObject({ fin: '0.00' });

    expect(result.immobilisations.totalDebut).toBe('304000.00');
    expect(result.immobilisations.totalAugmentations).toBe('86000.00');
    expect(result.immobilisations.totalDiminutions).toBe('0.00');
    expect(result.immobilisations.totalFin).toBe('390000.00');
  });

  it('matches the hand-computed multi-asset, multi-year oracle — Cadre II (amortissements)', () => {
    // Hand-computed — see tableau-2054-2055-oracle-fixture.ts and tableau-2055.spec.ts's own
    // per-category trace. Same Constructions fold as Cadre I above (CONSTRUCTIONS_SOL_PROPRE +
    // CONSTRUCTIONS_SOL_AUTRUI — but Entrepôt C/214000 has no dotation at all in this fixture, so
    // the fold contributes nothing extra beyond Bâtiment B's own 213000 figures).
    //   495 (Fonds commercial): 0/0/0/0
    //   500 (Autres incorp.): 0/0/0/0
    //   510 (Terrains): 0/0/0/0 (never amortized)
    //   520 (Constructions, 213000): début=10000, dotations=10000, fin=20000
    //   530 (Installations techniques, 215400): début=3000, dotations=3000, fin=6000
    //   540 (Installations générales): 0/0/0/0
    //   550 (Matériel de transport, 218200): début=6000, dotations=6000, fin=12000
    //   560 (Autres immo. corp., 218300): dotations=600, fin=600
    //   TOTAL: début=19000, dotations=19600, diminutions=0, fin=38600
    const result = computeTableau2033C(
      ORACLE_ASSETS,
      FY_2026,
      ORACLE_DEPRECIATION_ENTRIES,
      FY_2026,
    );

    expect(amortLigne(result, '495')).toMatchObject({ fin: '0.00' });
    expect(amortLigne(result, '500')).toMatchObject({ fin: '0.00' });
    expect(amortLigne(result, '510')).toMatchObject({ fin: '0.00' });
    expect(amortLigne(result, '520')).toMatchObject({
      debut: '10000.00',
      dotations: '10000.00',
      diminutions: '0.00',
      fin: '20000.00',
    });
    expect(amortLigne(result, '530')).toMatchObject({
      debut: '3000.00',
      dotations: '3000.00',
      fin: '6000.00',
    });
    expect(amortLigne(result, '540')).toMatchObject({ fin: '0.00' });
    expect(amortLigne(result, '550')).toMatchObject({
      debut: '6000.00',
      dotations: '6000.00',
      fin: '12000.00',
    });
    expect(amortLigne(result, '560')).toMatchObject({
      debut: '0.00',
      dotations: '600.00',
      fin: '600.00',
    });

    expect(result.amortissements.totalDebut).toBe('19000.00');
    expect(result.amortissements.totalDotations).toBe('19600.00');
    expect(result.amortissements.totalDiminutions).toBe('0.00');
    expect(result.amortissements.totalFin).toBe('38600.00');
  });

  it('reconciles to the exact same grand totals as computeTableau2054()/computeTableau2055() on the identical fixture — independently-specified, coarser row groupings, same underlying engine', () => {
    // The actual cross-regime reconciliation proof: 2033-C's row grouping (9 Cadre I rows / 8 Cadre
    // II rows, several of which FOLD multiple finer 2054/2055 categories together — e.g. "430
    // Constructions" folds what 2054 keeps as 3 separate rows) must still sum to the IDENTICAL grand
    // total as 2054/2055's own finer-grained totals, since both read the exact same underlying
    // asset/depreciation-entry data through the exact same classification primitives
    // (classifyAssetContributions/classifyDepreciationEntry/classifyDisposal), just regrouped
    // differently at display time.
    const tableau2033C = computeTableau2033C(
      ORACLE_ASSETS,
      FY_2026,
      ORACLE_DEPRECIATION_ENTRIES,
      FY_2026,
    );
    const tableau2054 = computeTableau2054(ORACLE_ASSETS, FY_2026);
    const tableau2055 = computeTableau2055(ORACLE_DEPRECIATION_ENTRIES, FY_2026);

    expect(tableau2033C.immobilisations.totalFin).toBe(tableau2054.totalGeneral);
    expect(tableau2033C.amortissements.totalFin).toBe(tableau2055.totalGeneral);

    // Net (fin immobilisations − fin amortissements) also reconciles, the same "net immobilisations"
    // figure both the 2054/2055 articulation check and this module's own data ultimately describe.
    const net2033C = Money.fromString(tableau2033C.immobilisations.totalFin).minus(
      Money.fromString(tableau2033C.amortissements.totalFin),
    );
    const net2054_2055 = Money.fromString(tableau2054.totalGeneral).minus(
      Money.fromString(tableau2055.totalGeneral),
    );
    expect(net2033C.toApiString()).toBe(net2054_2055.toApiString());
    expect(net2033C.toApiString()).toBe('351400.00');
  });

  it('a disposal WITHIN the reported year reduces fin via diminutions, in BOTH cadres, without touching début', () => {
    // Machine D (215400, INSTALLATIONS_TECHNIQUES — 2033-C row 440/530) disposed mid-year, same
    // scenario tableau-2054.spec.ts/tableau-2055.spec.ts already exercise independently.
    const disposedAssets = ORACLE_ASSETS.map((a) =>
      a.accountNumber === '215400' ? { ...a, cessionDate: new Date('2026-07-01') } : a,
    );
    const result = computeTableau2033C(
      disposedAssets,
      FY_2026,
      ORACLE_DEPRECIATION_ENTRIES,
      FY_2026,
      [{ accountNumber: '215400', amortissementsCumules: Money.fromString('6000.00') }],
    );

    expect(immobLigne(result, '440')).toMatchObject({
      debut: '30000.00',
      augmentations: '0.00',
      diminutions: '30000.00',
      fin: '0.00',
    });
    expect(amortLigne(result, '530')).toMatchObject({
      debut: '3000.00',
      dotations: '3000.00',
      diminutions: '6000.00',
      fin: '0.00',
    });
    expect(result.immobilisations.totalFin).toBe('360000.00'); // 390000.00 - 30000.00
    expect(result.amortissements.totalFin).toBe('32600.00'); // 38600.00 - 6000.00
  });

  it('refuses an asset acquired after the reported fiscal year ends (Cadre I) — propagates from classifyAssetContributions unmodified', () => {
    expect(() =>
      computeTableau2033C(
        [...ORACLE_ASSETS, LATER_ASSET],
        FY_2026,
        ORACLE_DEPRECIATION_ENTRIES,
        FY_2026,
      ),
    ).toThrow(/after the reported fiscal year ends/);
  });

  it('refuses a depreciation entry belonging to a fiscal year after the reported one ends (Cadre II) — propagates from classifyDepreciationEntry unmodified', () => {
    expect(() =>
      computeTableau2033C(
        ORACLE_ASSETS,
        FY_2026,
        [...ORACLE_DEPRECIATION_ENTRIES, LATER_DEPRECIATION_ENTRY],
        FY_2026,
      ),
    ).toThrow(/after the reported fiscal year ends/);
  });

  it('every untouched row is zero, not omitted — Fonds commercial / Autres incorp. / Installations générales / Immobilisations financières', () => {
    const result = computeTableau2033C(
      ORACLE_ASSETS,
      FY_2026,
      ORACLE_DEPRECIATION_ENTRIES,
      FY_2026,
    );
    for (const code of ['400', '410', '450', '480']) {
      expect(immobLigne(result, code)).toMatchObject({
        debut: '0.00',
        augmentations: '0.00',
        diminutions: '0.00',
        fin: '0.00',
      });
    }
    for (const code of ['495', '500', '510', '540']) {
      expect(amortLigne(result, code)).toMatchObject({
        debut: '0.00',
        dotations: '0.00',
        diminutions: '0.00',
        fin: '0.00',
      });
    }
  });
});
