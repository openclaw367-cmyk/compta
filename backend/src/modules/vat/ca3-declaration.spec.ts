import { Prisma } from '@prisma/client';
import { Ca3Ligne, Ca3VatRate, computeCa3Declaration } from './ca3-declaration';

const RATE_20 = 'rate-20';
const RATE_10 = 'rate-10';
const RATE_5_5 = 'rate-5-5';
const RATE_2_1 = 'rate-2-1';
const RATE_8_5_DOM = 'rate-8-5-dom'; // not implemented — used to test the guard

const VAT_RATES: Ca3VatRate[] = [
  { id: RATE_20, ratePercent: new Prisma.Decimal('20.00') },
  { id: RATE_10, ratePercent: new Prisma.Decimal('10.00') },
  { id: RATE_5_5, ratePercent: new Prisma.Decimal('5.50') },
  { id: RATE_2_1, ratePercent: new Prisma.Decimal('2.10') },
  { id: RATE_8_5_DOM, ratePercent: new Prisma.Decimal('8.50') },
];

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('computeCa3Declaration', () => {
  it('matches a hand-computed CA3 across all four implemented rates plus déductible (TVA due case)', () => {
    // Hand-computed oracle:
    //   Collectée: 20% -> HT 1000.00 / TVA 200.00 ; 10% -> HT 500.00 / TVA 50.00 ;
    //              5,5% -> HT 200.00 / TVA 11.00 ; 2,1% -> HT 100.00 / TVA 2.10
    //   Ligne 16 (precise) = 200.00 + 50.00 + 11.00 + 2.10 = 263.10 -> rounds to 263.00
    //   Ligne 19 (immobilisations déductible) = 160.00
    //   Ligne 20 (autres biens et services déductible) = 60.00
    //   Ligne 23 = 220.00
    //   16 (263.10) > 23 (220.00) -> TVA due (ligne TD) = 263.10 - 220.00 = 43.10 -> rounds to 43.00
    //   Ligne 25 (crédit) = null ; Ligne 28 = 43.00 ; Ligne 32 = 43.00
    const lignes: Ca3Ligne[] = [
      // Vente taux normal 20 % : HT 1000.00, TVA 200.00
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('1000.00'), vatRateId: RATE_20 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('200.00'), vatRateId: RATE_20 },
      { compteNumber: '411000', pcgClass: 4, debit: d('1200.00'), credit: d('0.00'), vatRateId: null },
      // Vente taux réduit 10 % : HT 500.00, TVA 50.00
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('500.00'), vatRateId: RATE_10 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('50.00'), vatRateId: RATE_10 },
      { compteNumber: '411000', pcgClass: 4, debit: d('550.00'), credit: d('0.00'), vatRateId: null },
      // Vente taux réduit 5,5 % : HT 200.00, TVA 11.00
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('200.00'), vatRateId: RATE_5_5 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('11.00'), vatRateId: RATE_5_5 },
      { compteNumber: '411000', pcgClass: 4, debit: d('211.00'), credit: d('0.00'), vatRateId: null },
      // Vente T6 (2,1 % continentale) : HT 100.00, TVA 2.10
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('100.00'), vatRateId: RATE_2_1 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('2.10'), vatRateId: RATE_2_1 },
      { compteNumber: '411000', pcgClass: 4, debit: d('102.10'), credit: d('0.00'), vatRateId: null },
      // Achat d'immobilisation : HT 800.00, TVA déductible 160.00
      { compteNumber: '218300', pcgClass: 2, debit: d('800.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '445662', pcgClass: 4, debit: d('160.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '404000', pcgClass: 4, debit: d('0.00'), credit: d('960.00'), vatRateId: null },
      // Achat de biens/services : HT 300.00, TVA déductible 60.00
      { compteNumber: '607000', pcgClass: 6, debit: d('300.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '445660', pcgClass: 4, debit: d('60.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '401000', pcgClass: 4, debit: d('0.00'), credit: d('360.00'), vatRateId: null },
    ];

    const result = computeCa3Declaration(lignes, VAT_RATES, '2026-01-01', '2026-01-31');

    expect(result.collecteeByRate).toEqual([
      { ligne: '08', label: 'Taux normal 20 %', ratePercent: '20.00', baseHT: '1000.00', taxe: '200.00' },
      { ligne: '9B', label: 'Taux réduit 10 %', ratePercent: '10.00', baseHT: '500.00', taxe: '50.00' },
      { ligne: '09', label: 'Taux réduit 5,5 %', ratePercent: '5.50', baseHT: '200.00', taxe: '11.00' },
      {
        ligne: 'T6',
        label: 'Taux réduit 2,1 % (France continentale)',
        ratePercent: '2.10',
        baseHT: '100.00',
        taxe: '2.00', // 2.10 rounds down (fraction 0.10 < 0.50)
      },
    ]);
    expect(result.ligne16).toBe('263.00'); // precise 263.10 -> rounds down (0.10 < 0.50)
    expect(result.ligne19).toBe('160.00');
    expect(result.ligne20).toBe('60.00');
    expect(result.ligne23).toBe('220.00');
    expect(result.ligne25).toBeNull();
    expect(result.ligneTD).toBe('43.00'); // precise 263.10 - 220.00 = 43.10 -> rounds down
    expect(result.ligne28).toBe('43.00');
    expect(result.ligne32).toBe('43.00');
  });

  it('matches a hand-computed CA3 where déductible exceeds collectée (crédit de TVA case)', () => {
    // Hand-computed oracle: collectée 20% HT 100.00 / TVA 20.00 ; déductible immo 500.00.
    // Ligne 16 = 20.00 ; Ligne 23 = 500.00 ; 23 > 16 -> crédit (ligne 25) = 480.00, TD = null.
    const lignes: Ca3Ligne[] = [
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('100.00'), vatRateId: RATE_20 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('20.00'), vatRateId: RATE_20 },
      { compteNumber: '445662', pcgClass: 4, debit: d('500.00'), credit: d('0.00'), vatRateId: null },
    ];

    const result = computeCa3Declaration(lignes, VAT_RATES, '2026-02-01', '2026-02-28');

    expect(result.ligne16).toBe('20.00');
    expect(result.ligne19).toBe('500.00');
    expect(result.ligne23).toBe('500.00');
    expect(result.ligne25).toBe('480.00');
    expect(result.ligneTD).toBeNull();
    expect(result.ligne28).toBe('0.00'); // nothing due while in a credit position
    expect(result.ligne32).toBe('0.00');
  });

  it('rounds a precise .50 fraction up, per the notice\'s "0,50 compté pour 1" rule', () => {
    const lignes: Ca3Ligne[] = [
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('100.00'), vatRateId: RATE_20 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('20.50'), vatRateId: RATE_20 },
    ];
    const result = computeCa3Declaration(lignes, VAT_RATES, '2026-01-01', '2026-01-31');
    expect(result.collecteeByRate[0].taxe).toBe('21.00');
    expect(result.ligne16).toBe('21.00');
    expect(result.ligneTD).toBe('21.00');
  });

  it('reports zero for an implemented rate with no activity in the period', () => {
    const lignes: Ca3Ligne[] = [
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('100.00'), vatRateId: RATE_20 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('20.00'), vatRateId: RATE_20 },
    ];
    const result = computeCa3Declaration(lignes, VAT_RATES, '2026-01-01', '2026-01-31');
    const line10 = result.collecteeByRate.find((r) => r.ligne === '9B')!;
    expect(line10.baseHT).toBe('0.00');
    expect(line10.taxe).toBe('0.00');
  });

  it('refuses a TVA collectée line with no vatRateId', () => {
    const lignes: Ca3Ligne[] = [
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('20.00'), vatRateId: null },
    ];
    expect(() => computeCa3Declaration(lignes, VAT_RATES, '2026-01-01', '2026-01-31')).toThrow(
      /no vatRateId/,
    );
  });

  it('refuses a rate that is not one of the four implemented rates', () => {
    const lignes: Ca3Ligne[] = [
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('100.00'), vatRateId: RATE_8_5_DOM },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('8.50'), vatRateId: RATE_8_5_DOM },
    ];
    expect(() => computeCa3Declaration(lignes, VAT_RATES, '2026-01-01', '2026-01-31')).toThrow(
      /not one of the currently-implemented CA3 rates/,
    );
  });

  it('refuses a déductible 4456-prefixed account other than the two mapped ones', () => {
    const lignes: Ca3Ligne[] = [
      { compteNumber: '445670', pcgClass: 4, debit: d('10.00'), credit: d('0.00'), vatRateId: null },
    ];
    expect(() => computeCa3Declaration(lignes, VAT_RATES, '2026-01-01', '2026-01-31')).toThrow(
      /not yet mapped to a CA3 line/,
    );
  });

  it('refuses a negative bucket rather than silently reporting it, per "ne jamais indiquer de sommes négatives"', () => {
    // A credit note larger than the period's sales at that rate nets negative — deferred (régularisations).
    const lignes: Ca3Ligne[] = [
      { compteNumber: '445710', pcgClass: 4, debit: d('50.00'), credit: d('10.00'), vatRateId: RATE_20 },
    ];
    expect(() => computeCa3Declaration(lignes, VAT_RATES, '2026-01-01', '2026-01-31')).toThrow(
      /negative/,
    );
  });

  it('ignores lines with no VAT relevance (untagged, non-VAT accounts)', () => {
    const lignes: Ca3Ligne[] = [
      { compteNumber: '512000', pcgClass: 5, debit: d('1000.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('1000.00'), vatRateId: null }, // untagged revenue
    ];
    const result = computeCa3Declaration(lignes, VAT_RATES, '2026-01-01', '2026-01-31');
    expect(result.ligne16).toBe('0.00');
    expect(result.ligne23).toBe('0.00');
    expect(result.collecteeByRate.every((r) => r.baseHT === '0.00')).toBe(true);
  });
});
