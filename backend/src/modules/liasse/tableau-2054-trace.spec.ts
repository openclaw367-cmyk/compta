import { Money } from '../../common/decimal';
import { FY_2025, FY_2026, ORACLE_ASSETS } from './tableau-2054-2055-oracle-fixture';
import { ImmobilisationMovementAssetWithId, traceTableau2054Column } from './tableau-2054-trace';

/**
 * Reuses the shared 2054/2055 oracle fixture (`tableau-2054-2055-oracle-fixture.ts`), enriched with
 * synthetic ids/labels — same "reuse the existing oracle fixture, don't build a new one" discipline
 * as Tier 1's `liasse-line-trace.spec.ts`.
 */
function withIds(): ImmobilisationMovementAssetWithId[] {
  return ORACLE_ASSETS.map((asset, i) => ({
    ...asset,
    assetId: `asset-${i}`,
    assetLabel: `Actif ${asset.accountNumber}`,
    accountId: `acc-${asset.accountNumber}`,
    accountLabel: `Compte ${asset.accountNumber}`,
  }));
}

describe('traceTableau2054Column', () => {
  it('traces TERRAINS/debut — Terrain A (211000), acquired 2025, ties to the report line', () => {
    const result = traceTableau2054Column(withIds(), FY_2026, 'TERRAINS', 'debut');
    expect(result.columnValue).toBe('50000.00');
    expect(result.drillableToEcritures).toBe(false);
    expect(result.assets).toEqual([
      expect.objectContaining({ accountNumber: '211000', contribution: '50000.00' }),
    ]);
  });

  it('traces AUTRES_CORP_MATERIEL_BUREAU/acquisitions — Ordinateurs E (218300), acquired 2026', () => {
    const result = traceTableau2054Column(
      withIds(),
      FY_2026,
      'AUTRES_CORP_MATERIEL_BUREAU',
      'acquisitions',
    );
    expect(result.columnValue).toBe('6000.00');
    expect(result.drillableToEcritures).toBe(true);
    expect(result.assets).toEqual([
      expect.objectContaining({ accountNumber: '218300', contribution: '6000.00' }),
    ]);
  });

  it('a row merging two finer categories (AUTRES_POSTES_INCORPORELLES = FONDS_COMMERCIAL + AUTRES_INCORPORELLES) sums both — the landmine this trace must not miss', () => {
    const assets: ImmobilisationMovementAssetWithId[] = [
      {
        accountNumber: '207000',
        acquisitionDate: new Date('2026-01-15'),
        acquisitionValue: Money.fromString('4000.00'),
        cessionDate: null,
        assetId: 'asset-fc',
        assetLabel: 'Fonds commercial X',
        accountId: 'acc-207000',
        accountLabel: 'Fonds commercial',
      },
      {
        accountNumber: '206000',
        acquisitionDate: new Date('2026-02-20'),
        acquisitionValue: Money.fromString('1500.00'),
        cessionDate: null,
        assetId: 'asset-ai',
        assetLabel: 'Droit au bail Y',
        accountId: 'acc-206000',
        accountLabel: 'Droit au bail',
      },
    ];
    const result = traceTableau2054Column(
      assets,
      FY_2026,
      'AUTRES_POSTES_INCORPORELLES',
      'acquisitions',
    );
    expect(result.columnValue).toBe('5500.00');
    expect(result.assets).toHaveLength(2);
    expect(result.assets.map((a) => a.contribution).sort()).toEqual(['1500.00', '4000.00']);
  });

  it('traces the cessions column for an asset acquired in a prior year and disposed this year', () => {
    const assets: ImmobilisationMovementAssetWithId[] = [
      {
        accountNumber: '211000',
        acquisitionDate: new Date('2025-01-01'),
        acquisitionValue: Money.fromString('20000.00'),
        cessionDate: new Date('2026-06-15'),
        assetId: 'asset-disposed',
        assetLabel: 'Terrain cédé',
        accountId: 'acc-211000',
        accountLabel: 'Terrains',
      },
    ];
    const result = traceTableau2054Column(assets, FY_2026, 'TERRAINS', 'cessions');
    expect(result.columnValue).toBe('20000.00');
    expect(result.drillableToEcritures).toBe(true);
    expect(result.assets).toEqual([
      expect.objectContaining({ accountNumber: '211000', contribution: '20000.00' }),
    ]);
    // The same asset ALSO contributes to 'debut' (its own gross value was carried in) — proving the
    // two contributions are independent, not mutually exclusive, per classifyAssetContributions()'s
    // own doc comment.
    const debutResult = traceTableau2054Column(assets, FY_2026, 'TERRAINS', 'debut');
    expect(debutResult.columnValue).toBe('20000.00');
  });

  it('refuses an unknown row code rather than faking a decomposition', () => {
    expect(() => traceTableau2054Column(withIds(), FY_2026, 'NOT_A_REAL_CODE', 'debut')).toThrow(
      /n'est pas traçable/,
    );
  });

  it('FY2025 (a different reported year) ties correctly too — proves this is not hardcoded to FY2026', () => {
    // Reporting FY2025 itself: only assets acquired in or before FY2025 are valid input (the caller's
    // own job to pre-filter, same precondition computeTableau2054() already documents) — Terrain A
    // (acquired 2025-03-01) is THIS year's own acquisition on FY2025, not "début".
    const fy2025Assets = withIds().filter((a) => a.acquisitionDate <= FY_2025.endDate);
    const result = traceTableau2054Column(fy2025Assets, FY_2025, 'TERRAINS', 'acquisitions');
    expect(result.columnValue).toBe('50000.00');
  });
});
