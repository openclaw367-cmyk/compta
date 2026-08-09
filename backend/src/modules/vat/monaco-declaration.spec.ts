import { Prisma } from '@prisma/client';
import { MonacoLigne, MonacoVatRate, computeMonacoDeclaration } from './monaco-declaration';

const RATE_20 = 'rate-20';
const RATE_10 = 'rate-10';
const RATE_5_5 = 'rate-5-5';
const RATE_2_1 = 'rate-2-1';
const RATE_8_5_UNIMPLEMENTED = 'rate-8-5'; // not one of Monaco's four — used to test the guard

const VAT_RATES: MonacoVatRate[] = [
  { id: RATE_20, ratePercent: new Prisma.Decimal('20.00') },
  { id: RATE_10, ratePercent: new Prisma.Decimal('10.00') },
  { id: RATE_5_5, ratePercent: new Prisma.Decimal('5.50') },
  { id: RATE_2_1, ratePercent: new Prisma.Decimal('2.10') },
  { id: RATE_8_5_UNIMPLEMENTED, ratePercent: new Prisma.Decimal('8.50') },
];

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('computeMonacoDeclaration', () => {
  it('matches a hand-computed declaration across all four implemented rates plus déductible (due case)', () => {
    // Hand-computed oracle:
    //   Collectée: taux normal 20% -> HT 1000.00 / taxe 200.00 ; taux intermédiaire 10% -> HT 500.00 / taxe 50.00 ;
    //              taux réduit 5,5% -> HT 200.00 / taxe 11.00 ; taux particulier 2,1% (ligne 30) -> HT 1000.00 / taxe 21.00
    //   Ligne B1 = 200.00 + 50.00 + 11.00 + 21.00 = 282.00
    //   Ligne 44 (immobilisations déductible) = 90.00
    //   Ligne 45 (autres biens et services déductible) = 60.00
    //   Ligne B2 = 150.00
    //   B1 (282.00) > B2 (150.00) -> ligne 48 (TVA nette due) = 282.00 - 150.00 = 132.00
    //   Ligne B3 (crédit) = null ; ligne 60 (total à payer) = 132.00
    const lignes: MonacoLigne[] = [
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('1000.00'), vatRateId: RATE_20 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('200.00'), vatRateId: RATE_20 },
      { compteNumber: '411000', pcgClass: 4, debit: d('1200.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('500.00'), vatRateId: RATE_10 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('50.00'), vatRateId: RATE_10 },
      { compteNumber: '411000', pcgClass: 4, debit: d('550.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('200.00'), vatRateId: RATE_5_5 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('11.00'), vatRateId: RATE_5_5 },
      { compteNumber: '411000', pcgClass: 4, debit: d('211.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('1000.00'), vatRateId: RATE_2_1 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('21.00'), vatRateId: RATE_2_1 },
      { compteNumber: '411000', pcgClass: 4, debit: d('1021.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '218300', pcgClass: 2, debit: d('450.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '445662', pcgClass: 4, debit: d('90.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '404000', pcgClass: 4, debit: d('0.00'), credit: d('540.00'), vatRateId: null },
      { compteNumber: '607000', pcgClass: 6, debit: d('300.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '445660', pcgClass: 4, debit: d('60.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '401000', pcgClass: 4, debit: d('0.00'), credit: d('360.00'), vatRateId: null },
    ];

    const result = computeMonacoDeclaration(lignes, VAT_RATES, '2026-05-01', '2026-05-31');

    expect(result.collecteeByRate).toEqual([
      { ligne: '30', label: 'Taux particulier 2,1 %', ratePercent: '2.10', baseHT: '1000.00', taxe: '21.00' },
      { ligne: '32', label: 'Taux réduit', ratePercent: '5.50', baseHT: '200.00', taxe: '11.00' },
      { ligne: '32', label: 'Taux intermédiaire', ratePercent: '10.00', baseHT: '500.00', taxe: '50.00' },
      { ligne: '32', label: 'Taux normal', ratePercent: '20.00', baseHT: '1000.00', taxe: '200.00' },
    ]);
    expect(result.ligneB1).toBe('282.00');
    expect(result.ligne44).toBe('90.00');
    expect(result.ligne45).toBe('60.00');
    expect(result.ligneB2).toBe('150.00');
    expect(result.ligneB3).toBeNull();
    expect(result.ligne48).toBe('132.00');
    expect(result.ligne60).toBe('132.00');
  });

  it('matches a hand-computed declaration where déductible exceeds collectée (crédit case)', () => {
    // Hand-computed oracle: collectée 20% HT 100.00 / taxe 20.00 ; déductible immo 500.00.
    // Ligne B1 = 20.00 ; ligne B2 = 500.00 ; B2 > B1 -> crédit (ligne B3) = 480.00, ligne 48 = null, ligne 60 = 0.00.
    const lignes: MonacoLigne[] = [
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('100.00'), vatRateId: RATE_20 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('20.00'), vatRateId: RATE_20 },
      { compteNumber: '445662', pcgClass: 4, debit: d('500.00'), credit: d('0.00'), vatRateId: null },
    ];

    const result = computeMonacoDeclaration(lignes, VAT_RATES, '2026-06-01', '2026-06-30');

    expect(result.ligneB1).toBe('20.00');
    expect(result.ligne44).toBe('500.00');
    expect(result.ligneB2).toBe('500.00');
    expect(result.ligneB3).toBe('480.00');
    expect(result.ligne48).toBeNull();
    expect(result.ligne60).toBe('0.00');
  });

  it('rounds a precise .50 fraction up', () => {
    const lignes: MonacoLigne[] = [
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('100.00'), vatRateId: RATE_20 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('20.50'), vatRateId: RATE_20 },
    ];
    const result = computeMonacoDeclaration(lignes, VAT_RATES, '2026-05-01', '2026-05-31');
    const normal = result.collecteeByRate.find((r) => r.label === 'Taux normal')!;
    expect(normal.taxe).toBe('21.00');
    expect(result.ligneB1).toBe('21.00');
    expect(result.ligne48).toBe('21.00');
  });

  it('reports zero for an implemented rate with no activity in the period', () => {
    const lignes: MonacoLigne[] = [
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('100.00'), vatRateId: RATE_20 },
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('20.00'), vatRateId: RATE_20 },
    ];
    const result = computeMonacoDeclaration(lignes, VAT_RATES, '2026-05-01', '2026-05-31');
    const intermediaire = result.collecteeByRate.find((r) => r.label === 'Taux intermédiaire')!;
    expect(intermediaire.baseHT).toBe('0.00');
    expect(intermediaire.taxe).toBe('0.00');
  });

  it('refuses a TVA collectée line with no vatRateId', () => {
    const lignes: MonacoLigne[] = [
      { compteNumber: '445710', pcgClass: 4, debit: d('0.00'), credit: d('20.00'), vatRateId: null },
    ];
    expect(() => computeMonacoDeclaration(lignes, VAT_RATES, '2026-05-01', '2026-05-31')).toThrow(
      /no vatRateId/,
    );
  });

  it('refuses a rate that is not one of the four implemented rates', () => {
    const lignes: MonacoLigne[] = [
      {
        compteNumber: '707000',
        pcgClass: 7,
        debit: d('0.00'),
        credit: d('100.00'),
        vatRateId: RATE_8_5_UNIMPLEMENTED,
      },
      {
        compteNumber: '445710',
        pcgClass: 4,
        debit: d('0.00'),
        credit: d('8.50'),
        vatRateId: RATE_8_5_UNIMPLEMENTED,
      },
    ];
    expect(() => computeMonacoDeclaration(lignes, VAT_RATES, '2026-05-01', '2026-05-31')).toThrow(
      /not one of the currently-implemented Monaco rates/,
    );
  });

  it('refuses a déductible 4456-prefixed account other than the two mapped ones', () => {
    const lignes: MonacoLigne[] = [
      { compteNumber: '445670', pcgClass: 4, debit: d('10.00'), credit: d('0.00'), vatRateId: null },
    ];
    expect(() => computeMonacoDeclaration(lignes, VAT_RATES, '2026-05-01', '2026-05-31')).toThrow(
      /not yet mapped to a Monaco line/,
    );
  });

  it('refuses a negative bucket rather than silently reporting it', () => {
    const lignes: MonacoLigne[] = [
      { compteNumber: '445710', pcgClass: 4, debit: d('50.00'), credit: d('10.00'), vatRateId: RATE_20 },
    ];
    expect(() => computeMonacoDeclaration(lignes, VAT_RATES, '2026-05-01', '2026-05-31')).toThrow(
      /negative/,
    );
  });

  it('ignores lines with no VAT relevance (untagged, non-VAT accounts)', () => {
    const lignes: MonacoLigne[] = [
      { compteNumber: '512000', pcgClass: 5, debit: d('1000.00'), credit: d('0.00'), vatRateId: null },
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('1000.00'), vatRateId: null },
    ];
    const result = computeMonacoDeclaration(lignes, VAT_RATES, '2026-05-01', '2026-05-31');
    expect(result.ligneB1).toBe('0.00');
    expect(result.ligneB2).toBe('0.00');
    expect(result.collecteeByRate.every((r) => r.baseHT === '0.00')).toBe(true);
  });
});
