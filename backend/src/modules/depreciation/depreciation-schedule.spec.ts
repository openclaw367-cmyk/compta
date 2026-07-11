import { Prisma } from '@prisma/client';
import { computeLinearSchedule } from './depreciation-schedule';

function fiscalYear(id: string, startYear: number) {
  return {
    id,
    startDate: new Date(Date.UTC(startYear, 0, 1)),
    endDate: new Date(Date.UTC(startYear, 11, 31)),
  };
}

describe('computeLinearSchedule', () => {
  it('splits the base evenly across the useful life, absorbing rounding in the last year', () => {
    const asset = {
      acquisitionValue: new Prisma.Decimal('1000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      usefulLifeYears: 3,
      serviceStartDate: new Date(Date.UTC(2026, 0, 1)),
    };
    const fiscalYears = [
      fiscalYear('fy-2026', 2026),
      fiscalYear('fy-2027', 2027),
      fiscalYear('fy-2028', 2028),
    ];

    const schedule = computeLinearSchedule(asset, fiscalYears);

    expect(schedule.map((line) => line.amount.toApiString())).toEqual([
      '333.33',
      '333.33',
      '333.34',
    ]);

    const total = schedule.reduce(
      (sum, line) => sum.plus(line.amount),
      schedule[0].amount.times(0),
    );
    expect(total.toApiString()).toBe('1000.00');
  });

  it('accounts for a non-zero residual value', () => {
    const asset = {
      acquisitionValue: new Prisma.Decimal('10000.00'),
      residualValue: new Prisma.Decimal('1000.00'),
      usefulLifeYears: 3,
      serviceStartDate: new Date(Date.UTC(2026, 0, 1)),
    };
    const fiscalYears = [
      fiscalYear('fy-2026', 2026),
      fiscalYear('fy-2027', 2027),
      fiscalYear('fy-2028', 2028),
    ];

    const schedule = computeLinearSchedule(asset, fiscalYears);
    expect(schedule).toHaveLength(3);
    expect(schedule[0].amount.toApiString()).toBe('3000.00');
  });

  it('throws rather than approximate a mid-year acquisition (prorata temporis unimplemented)', () => {
    const asset = {
      acquisitionValue: new Prisma.Decimal('1000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      usefulLifeYears: 1,
      serviceStartDate: new Date(Date.UTC(2026, 5, 15)), // mid-year
    };
    const fiscalYears = [fiscalYear('fy-2026', 2026)];

    expect(() => computeLinearSchedule(asset, fiscalYears)).toThrow(/prorata temporis/);
  });

  it('throws when the depreciable base is not positive', () => {
    const asset = {
      acquisitionValue: new Prisma.Decimal('1000.00'),
      residualValue: new Prisma.Decimal('1000.00'),
      usefulLifeYears: 3,
      serviceStartDate: new Date(Date.UTC(2026, 0, 1)),
    };
    expect(() => computeLinearSchedule(asset, [])).toThrow(/positive/);
  });
});
