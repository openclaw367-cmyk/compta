import { Money } from '../../common/decimal';
import { FY_2025, FY_2026, ORACLE_DEPRECIATION_ENTRIES } from './tableau-2054-2055-oracle-fixture';
import {
  ImmobilisationDepreciationMovementWithId,
  ImmobilisationDisposalWithId,
  traceTableau2055Column,
} from './tableau-2055-trace';

/** Synthetic gross-account -> depreciation-account map, standing in for FixedAsset.depreciationAccount. */
const DEP_ACCOUNT_NUMBER: Record<string, string> = {
  '213000': '281300',
  '215400': '281540',
  '218200': '281820',
  '218300': '281830',
};

/** Reuses the shared 2054/2055 oracle fixture's own depreciation entries, enriched with ids. */
function withIds(): ImmobilisationDepreciationMovementWithId[] {
  return ORACLE_DEPRECIATION_ENTRIES.map((entry, i) => ({
    ...entry,
    entryId: `entry-${i}`,
    assetId: `asset-${entry.accountNumber}`,
    assetLabel: `Actif ${entry.accountNumber}`,
    depreciationAccountId: `dep-acc-${entry.accountNumber}`,
    depreciationAccountNumber: DEP_ACCOUNT_NUMBER[entry.accountNumber],
    depreciationAccountLabel: `Amortissements ${entry.accountNumber}`,
  }));
}

describe('traceTableau2055Column', () => {
  it("traces CONSTRUCTIONS_SOL_PROPRE/debut — Bâtiment B (213000)'s FY2025 dotation, ties to the report line", () => {
    const result = traceTableau2055Column([], [], FY_2026, 'CONSTRUCTIONS_SOL_PROPRE', 'debut');
    // sanity: empty input ties to 0
    expect(result.columnValue).toBe('0.00');

    const result2 = traceTableau2055Column(
      withIds(),
      [],
      FY_2026,
      'CONSTRUCTIONS_SOL_PROPRE',
      'debut',
    );
    expect(result2.columnValue).toBe('10000.00');
    expect(result2.details).toEqual([
      expect.objectContaining({
        accountNumber: '281300', // the DEPRECIATION account (281300), not the gross one (213000)
        contribution: '10000.00',
        fiscalYearId: FY_2025.id, // the entry's OWN real year, not the reported one — the whole point
      }),
    ]);
  });

  it("traces CONSTRUCTIONS_SOL_PROPRE/dotations — Bâtiment B's FY2026 dotation, scoped to the reported year", () => {
    const result = traceTableau2055Column(
      withIds(),
      [],
      FY_2026,
      'CONSTRUCTIONS_SOL_PROPRE',
      'dotations',
    );
    expect(result.columnValue).toBe('10000.00');
    expect(result.details).toEqual([
      expect.objectContaining({
        accountNumber: '281300',
        contribution: '10000.00',
        fiscalYearId: FY_2026.id,
      }),
    ]);
  });

  it('an asset with entries across BOTH years produces two separate début rows when it has more than one prior-year entry', () => {
    // Synthetic: two prior-year entries on the same asset (215400), one per year — proves "début" is
    // per-ENTRY, not merged per-asset, since each carries its own distinct, real fiscal year.
    const entries: ImmobilisationDepreciationMovementWithId[] = [
      {
        accountNumber: '215400',
        fiscalYearId: 'fy-2023',
        fiscalYearEndDate: new Date('2023-12-31'),
        amount: Money.fromString('2500.00'),
        entryId: 'e1',
        assetId: 'asset-machine-d',
        assetLabel: 'Machine D',
        depreciationAccountId: 'dep-215400',
        depreciationAccountNumber: '281540',
        depreciationAccountLabel: 'Amortissements installations techniques',
      },
      {
        accountNumber: '215400',
        fiscalYearId: FY_2025.id,
        fiscalYearEndDate: FY_2025.endDate,
        amount: Money.fromString('3000.00'),
        entryId: 'e2',
        assetId: 'asset-machine-d',
        assetLabel: 'Machine D',
        depreciationAccountId: 'dep-215400',
        depreciationAccountNumber: '281540',
        depreciationAccountLabel: 'Amortissements installations techniques',
      },
    ];
    const result = traceTableau2055Column(
      entries,
      [],
      FY_2026,
      'INSTALLATIONS_TECHNIQUES',
      'debut',
    );
    expect(result.columnValue).toBe('5500.00');
    expect(result.details).toHaveLength(2);
    expect(result.details.map((d) => d.fiscalYearId).sort()).toEqual(
      ['fy-2023', FY_2025.id].sort(),
    );
  });

  it('traces diminutions for a disposed asset — amortissementsCumules, scoped to the reported (disposal) year', () => {
    const disposals: ImmobilisationDisposalWithId[] = [
      {
        accountNumber: '214000',
        amortissementsCumules: Money.fromString('1677.78'),
        assetId: 'asset-entrepot-c',
        assetLabel: 'Entrepôt C',
        depreciationAccountId: 'dep-214000',
        depreciationAccountNumber: '281400',
        depreciationAccountLabel: 'Amortissements constructions',
      },
    ];
    // 214000 -> CONSTRUCTIONS_SOL_AUTRUI (its own dedicated prefix, per immobilisation-categories.ts).
    const result = traceTableau2055Column(
      [],
      disposals,
      FY_2026,
      'CONSTRUCTIONS_SOL_AUTRUI',
      'diminutions',
    );
    expect(result.columnValue).toBe('1677.78');
    expect(result.details).toEqual([
      expect.objectContaining({
        accountNumber: '281400',
        contribution: '1677.78',
        fiscalYearId: FY_2026.id,
      }),
    ]);
  });

  it('refuses a category with no 2055 row (e.g. an "en cours" or financière category)', () => {
    expect(() =>
      traceTableau2055Column(withIds(), [], FY_2026, 'IMMOS_CORP_EN_COURS', 'debut'),
    ).toThrow(/n'est pas traçable/);
  });

  it('refuses an unknown category code', () => {
    expect(() => traceTableau2055Column(withIds(), [], FY_2026, 'NOT_REAL', 'debut')).toThrow(
      /n'est pas traçable/,
    );
  });
});
