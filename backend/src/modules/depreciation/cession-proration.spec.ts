import { Prisma } from '@prisma/client';
import { daysBetween360, computeFinalPeriodDotation } from './cession-proration';

function d(year: number, month1based: number, day: number): Date {
  return new Date(Date.UTC(year, month1based - 1, day));
}

describe('daysBetween360', () => {
  it('counts a full calendar year (Jan 1 - Dec 31) as exactly 360 days', () => {
    expect(daysBetween360(d(2026, 1, 1), d(2026, 12, 31))).toBe(360);
  });

  it('counts a half year (Jan 1 - Jun 30) as exactly 180 days', () => {
    expect(daysBetween360(d(2026, 1, 1), d(2026, 6, 30))).toBe(180);
  });

  it('counts the same day (period start == cession date) as 1 day', () => {
    expect(daysBetween360(d(2026, 5, 1), d(2026, 5, 1))).toBe(1);
  });

  it('clamps day 31 to day 30 on both ends (30E/360)', () => {
    // Jan 31 -> Mar 31: naive calendar math gives 2 months + 0 days; 30E/360 clamps both to 30,
    // giving exactly 2*30 = 60 (+1 inclusive) = 61.
    expect(daysBetween360(d(2026, 1, 31), d(2026, 3, 31))).toBe(61);
  });

  it('throws if end is before start', () => {
    expect(() => daysBetween360(d(2026, 6, 1), d(2026, 1, 1))).toThrow(
      /end .* is before start/,
    );
  });
});

describe('computeFinalPeriodDotation', () => {
  const asset = {
    acquisitionValue: new Prisma.Decimal('1000.00'),
    residualValue: new Prisma.Decimal('0.00'),
    usefulLifeYears: 5, // annual amount = 200.00
  };

  it('prorates exactly half the annual amount for a half-year disposal', () => {
    const amount = computeFinalPeriodDotation(asset, d(2026, 1, 1), d(2026, 6, 30));
    expect(amount.toApiString()).toBe('100.00');
  });

  it('reproduces the full annual amount for a disposal on the fiscal year\'s own last day', () => {
    const amount = computeFinalPeriodDotation(asset, d(2026, 1, 1), d(2026, 12, 31));
    expect(amount.toApiString()).toBe('200.00');
  });

  it('handles acquisition and disposal within the same fiscal year (periodStart = serviceStartDate)', () => {
    // Asset put in service March 15, disposed September 20 — 190 days of use.
    const amount = computeFinalPeriodDotation(asset, d(2026, 3, 15), d(2026, 9, 20));
    // 30E/360: months = 6, d1=15, d2=20 -> 6*30 + (20-15) + 1 = 180+5+1 = 186 days.
    expect(amount.toApiString()).toBe('103.33'); // 200.00 * 186/360
  });

  it('throws if cessionDate is before periodStart', () => {
    expect(() => computeFinalPeriodDotation(asset, d(2026, 6, 1), d(2026, 1, 1))).toThrow(
      /cessionDate .* is before periodStart/,
    );
  });
});
