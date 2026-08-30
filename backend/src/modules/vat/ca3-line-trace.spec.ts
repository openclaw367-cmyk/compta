import { Prisma } from '@prisma/client';
import { Ca3VatRate } from './ca3-declaration';
import { Ca3LigneWithAccount, traceCa3RateColumn } from './ca3-line-trace';

const RATE_20 = 'rate-20';
const RATE_10 = 'rate-10';
const RATE_5_5 = 'rate-5-5';
const RATE_2_1 = 'rate-2-1';

const VAT_RATES: Ca3VatRate[] = [
  { id: RATE_20, ratePercent: new Prisma.Decimal('20.00') },
  { id: RATE_10, ratePercent: new Prisma.Decimal('10.00') },
  { id: RATE_5_5, ratePercent: new Prisma.Decimal('5.50') },
  { id: RATE_2_1, ratePercent: new Prisma.Decimal('2.10') },
];

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/**
 * Reuses ca3-declaration.spec.ts's own first oracle dataset (not a new fixture) — deliberately
 * keeps 445710 (TVA collectée) carrying ALL FOUR rates across different lignes, exactly the
 * landmine this trace exists to handle correctly: account 445710 is NOT itself classified to one
 * rate, only each individual ligne is (via vatRateId).
 */
const LIGNES: Ca3LigneWithAccount[] = [
  {
    compteNumber: '707000',
    accountId: 'acc-707000',
    accountLabel: 'Ventes de marchandises',
    pcgClass: 7,
    debit: d('0.00'),
    credit: d('1000.00'),
    vatRateId: RATE_20,
  },
  {
    compteNumber: '445710',
    accountId: 'acc-445710',
    accountLabel: 'TVA collectée',
    pcgClass: 4,
    debit: d('0.00'),
    credit: d('200.00'),
    vatRateId: RATE_20,
  },
  {
    compteNumber: '411000',
    accountId: 'acc-411000',
    accountLabel: 'Clients',
    pcgClass: 4,
    debit: d('1200.00'),
    credit: d('0.00'),
    vatRateId: null,
  },
  {
    compteNumber: '707000',
    accountId: 'acc-707000',
    accountLabel: 'Ventes de marchandises',
    pcgClass: 7,
    debit: d('0.00'),
    credit: d('500.00'),
    vatRateId: RATE_10,
  },
  {
    compteNumber: '445710',
    accountId: 'acc-445710',
    accountLabel: 'TVA collectée',
    pcgClass: 4,
    debit: d('0.00'),
    credit: d('50.00'),
    vatRateId: RATE_10,
  },
  {
    compteNumber: '411000',
    accountId: 'acc-411000',
    accountLabel: 'Clients',
    pcgClass: 4,
    debit: d('550.00'),
    credit: d('0.00'),
    vatRateId: null,
  },
  {
    compteNumber: '707000',
    accountId: 'acc-707000',
    accountLabel: 'Ventes de marchandises',
    pcgClass: 7,
    debit: d('0.00'),
    credit: d('200.00'),
    vatRateId: RATE_5_5,
  },
  {
    compteNumber: '445710',
    accountId: 'acc-445710',
    accountLabel: 'TVA collectée',
    pcgClass: 4,
    debit: d('0.00'),
    credit: d('11.00'),
    vatRateId: RATE_5_5,
  },
  {
    compteNumber: '411000',
    accountId: 'acc-411000',
    accountLabel: 'Clients',
    pcgClass: 4,
    debit: d('211.00'),
    credit: d('0.00'),
    vatRateId: null,
  },
  {
    compteNumber: '707000',
    accountId: 'acc-707000',
    accountLabel: 'Ventes de marchandises',
    pcgClass: 7,
    debit: d('0.00'),
    credit: d('100.00'),
    vatRateId: RATE_2_1,
  },
  {
    compteNumber: '445710',
    accountId: 'acc-445710',
    accountLabel: 'TVA collectée',
    pcgClass: 4,
    debit: d('0.00'),
    credit: d('2.10'),
    vatRateId: RATE_2_1,
  },
  {
    compteNumber: '411000',
    accountId: 'acc-411000',
    accountLabel: 'Clients',
    pcgClass: 4,
    debit: d('102.10'),
    credit: d('0.00'),
    vatRateId: null,
  },
  {
    compteNumber: '218300',
    accountId: 'acc-218300',
    accountLabel: 'Matériel',
    pcgClass: 2,
    debit: d('800.00'),
    credit: d('0.00'),
    vatRateId: null,
  },
  {
    compteNumber: '445662',
    accountId: 'acc-445662',
    accountLabel: 'TVA déductible immo',
    pcgClass: 4,
    debit: d('160.00'),
    credit: d('0.00'),
    vatRateId: null,
  },
  {
    compteNumber: '404000',
    accountId: 'acc-404000',
    accountLabel: 'Fournisseurs immo',
    pcgClass: 4,
    debit: d('0.00'),
    credit: d('960.00'),
    vatRateId: null,
  },
  {
    compteNumber: '607000',
    accountId: 'acc-607000',
    accountLabel: 'Achats',
    pcgClass: 6,
    debit: d('300.00'),
    credit: d('0.00'),
    vatRateId: null,
  },
  {
    compteNumber: '445660',
    accountId: 'acc-445660',
    accountLabel: 'TVA déductible autres',
    pcgClass: 4,
    debit: d('60.00'),
    credit: d('0.00'),
    vatRateId: null,
  },
  {
    compteNumber: '401000',
    accountId: 'acc-401000',
    accountLabel: 'Fournisseurs',
    pcgClass: 4,
    debit: d('0.00'),
    credit: d('360.00'),
    vatRateId: null,
  },
];

describe('traceCa3RateColumn', () => {
  it('traces ligne 08 (20%)/taxe to the single TVA collectée account, ties to 200.00 — not the OTHER rates on the same account', () => {
    const result = traceCa3RateColumn(LIGNES, VAT_RATES, '2026-01-01', '2026-01-31', '08', 'taxe');
    expect(result.columnValue).toBe('200.00');
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountNumber: '445710', contribution: '200.00' }),
    ]);
  });

  it('traces ligne 08 (20%)/baseHT to the revenue account, ties to 1000.00', () => {
    const result = traceCa3RateColumn(
      LIGNES,
      VAT_RATES,
      '2026-01-01',
      '2026-01-31',
      '08',
      'baseHT',
    );
    expect(result.columnValue).toBe('1000.00');
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountNumber: '707000', contribution: '1000.00' }),
    ]);
  });

  it('traces T6 (2,1%)/taxe — proves the rounding-at-sum-boundary discipline: raw 2.10 sums, THEN rounds to 2.00', () => {
    const result = traceCa3RateColumn(LIGNES, VAT_RATES, '2026-01-01', '2026-01-31', 'T6', 'taxe');
    expect(result.columnValue).toBe('2.00');
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountNumber: '445710', contribution: '2.10' }),
    ]);
  });

  it('the SAME account (445710) splits correctly across all four rate lignes — the landmine this trace exists for', () => {
    const r08 = traceCa3RateColumn(LIGNES, VAT_RATES, '2026-01-01', '2026-01-31', '08', 'taxe');
    const r9B = traceCa3RateColumn(LIGNES, VAT_RATES, '2026-01-01', '2026-01-31', '9B', 'taxe');
    const r09 = traceCa3RateColumn(LIGNES, VAT_RATES, '2026-01-01', '2026-01-31', '09', 'taxe');
    expect(r08.columnValue).toBe('200.00');
    expect(r9B.columnValue).toBe('50.00');
    expect(r09.columnValue).toBe('11.00');
    // Every one of these traces to the SAME account id, each with its own distinct contribution —
    // proving the classification is per-ligne, never per-account.
    expect(r08.accounts[0].accountId).toBe('acc-445710');
    expect(r9B.accounts[0].accountId).toBe('acc-445710');
    expect(r09.accounts[0].accountId).toBe('acc-445710');
  });

  it('refuses an unimplemented or unknown ligne code rather than faking a decomposition', () => {
    expect(() =>
      traceCa3RateColumn(LIGNES, VAT_RATES, '2026-01-01', '2026-01-31', 'NOT_REAL', 'taxe'),
    ).toThrow(/n'est pas traçable/);
  });

  it('a rate with zero activity ties to 0,00, not an error', () => {
    const onlyTwentyPercent = LIGNES.filter((l) => l.vatRateId === RATE_20 || !l.vatRateId);
    const result = traceCa3RateColumn(
      onlyTwentyPercent,
      VAT_RATES,
      '2026-01-01',
      '2026-01-31',
      '9B',
      'taxe',
    );
    expect(result.columnValue).toBe('0.00');
    expect(result.accounts).toEqual([]);
  });
});
