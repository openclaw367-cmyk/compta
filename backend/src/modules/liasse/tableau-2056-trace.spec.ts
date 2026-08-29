import { Money } from '../../common/decimal';
import { ORACLE_2056_LIGNES } from './tableau-2056-oracle-fixture';
import { ProvisionMovementLigneWithAccount, traceTableau2056Column } from './tableau-2056-trace';

const FISCAL_YEAR_ID = 'fy-2026';

/** Reuses the shared 2056 oracle fixture's own lignes, enriched with account ids/labels. */
function withIds(): ProvisionMovementLigneWithAccount[] {
  return ORACLE_2056_LIGNES.map((ligne) => ({
    ...ligne,
    accountId: `acc-${ligne.accountNumber}`,
    accountLabel:
      ligne.accountNumber === '151200'
        ? 'Provisions garanties clients'
        : 'Dépréciation clients douteux',
  }));
}

describe('traceTableau2056Column', () => {
  it("traces GARANTIES_CLIENTS/dotations — 151200's 5 000,00 dotation, ties to the report line", () => {
    const result = traceTableau2056Column(
      withIds(),
      FISCAL_YEAR_ID,
      'GARANTIES_CLIENTS',
      'dotations',
    );
    expect(result.columnValue).toBe('5000.00');
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountNumber: '151200', contribution: '5000.00' }),
    ]);
  });

  it("traces GARANTIES_CLIENTS/reprises — the same account's 2 000,00 partial reprise", () => {
    const result = traceTableau2056Column(
      withIds(),
      FISCAL_YEAR_ID,
      'GARANTIES_CLIENTS',
      'reprises',
    );
    expect(result.columnValue).toBe('2000.00');
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountNumber: '151200', contribution: '2000.00' }),
    ]);
  });

  it("traces DEPREC_COMPTES_CLIENTS/dotations — 491000's 1 200,00 dotation", () => {
    const result = traceTableau2056Column(
      withIds(),
      FISCAL_YEAR_ID,
      'DEPREC_COMPTES_CLIENTS',
      'dotations',
    );
    expect(result.columnValue).toBe('1200.00');
  });

  it('an à-nouveau-sourced ligne traces to début, netting credit minus debit — and TWO accounts in the same category aggregate independently, not merged into one row', () => {
    const lignes: ProvisionMovementLigneWithAccount[] = [
      {
        accountNumber: '158100',
        isOpeningBalance: true,
        debit: Money.zero(),
        credit: Money.fromString('7000.00'),
        accountId: 'acc-158100',
        accountLabel: 'Autres provisions pour risques et charges A',
      },
      {
        accountNumber: '158200',
        isOpeningBalance: true,
        debit: Money.zero(),
        credit: Money.fromString('2500.00'),
        accountId: 'acc-158200',
        accountLabel: 'Autres provisions pour risques et charges B',
      },
    ];
    const result = traceTableau2056Column(
      lignes,
      FISCAL_YEAR_ID,
      'AUTRES_RISQUES_CHARGES',
      'debut',
    );
    expect(result.columnValue).toBe('9500.00');
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts.map((a) => a.contribution).sort()).toEqual(['2500.00', '7000.00']);
  });

  it('refuses an unknown category code rather than faking a decomposition', () => {
    expect(() =>
      traceTableau2056Column(withIds(), FISCAL_YEAR_ID, 'NOT_REAL', 'dotations'),
    ).toThrow(/n'est pas traçable/);
  });

  it('a category with zero contributions this column ties to 0,00, not an error', () => {
    const result = traceTableau2056Column(withIds(), FISCAL_YEAR_ID, 'LITIGES', 'dotations');
    expect(result.columnValue).toBe('0.00');
    expect(result.accounts).toEqual([]);
  });
});
