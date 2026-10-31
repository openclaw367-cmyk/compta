import { Prisma } from '@prisma/client';
import {
  computeLinearSchedule,
  computeDecliningSchedule,
  resolveDecliningCoefficient,
} from './depreciation-schedule';

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

describe('resolveDecliningCoefficient', () => {
  it('returns 1.25 for 3-4 years, 1.75 for 5-6 years, 2.25 for more than 6', () => {
    expect(resolveDecliningCoefficient(3)).toBe('1.25');
    expect(resolveDecliningCoefficient(4)).toBe('1.25');
    expect(resolveDecliningCoefficient(5)).toBe('1.75');
    expect(resolveDecliningCoefficient(6)).toBe('1.75');
    expect(resolveDecliningCoefficient(7)).toBe('2.25');
    expect(resolveDecliningCoefficient(10)).toBe('2.25');
  });

  it('throws for a useful life under 3 years — dégressif does not apply', () => {
    expect(() => resolveDecliningCoefficient(2)).toThrow(/at least 3 years/);
  });
});

describe('computeDecliningSchedule', () => {
  it('matches the standard textbook example (10 000,00 €, 5 years, coefficient 1.75), switching to linéaire in year 4', () => {
    const asset = {
      acquisitionValue: new Prisma.Decimal('10000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      usefulLifeYears: 5,
      serviceStartDate: new Date(Date.UTC(2026, 0, 1)),
    };
    const fiscalYears = [2026, 2027, 2028, 2029, 2030].map((y) => fiscalYear(`fy-${y}`, y));

    const schedule = computeDecliningSchedule(asset, fiscalYears);

    // Hand-traced: taux dégressif = (1/5)*1.75 = 35%.
    // Y1: max(10000*.35=3500.00, 10000/5=2000.00) = 3500.00 → vnc 6500.00
    // Y2: max(6500*.35=2275.00, 6500/4=1625.00) = 2275.00 → vnc 4225.00
    // Y3: max(4225*.35=1478.75, 4225/3=1408.33) = 1478.75 → vnc 2746.25
    // Y4: max(2746.25*.35=961.19, 2746.25/2=1373.13) = 1373.13 (switch!) → vnc 1373.12
    // Y5 (last, absorbs remainder): 10000.00 - 8626.88 = 1373.12
    expect(schedule.map((line) => line.amount.toApiString())).toEqual([
      '3500.00',
      '2275.00',
      '1478.75',
      '1373.13',
      '1373.12',
    ]);

    const total = schedule.reduce(
      (sum, line) => sum.plus(line.amount),
      schedule[0].amount.times(0),
    );
    expect(total.toApiString()).toBe('10000.00');
  });

  it('matches a second hand-traced example (1 000,00 €, 3 years, coefficient 1.25), switching to linéaire in year 2', () => {
    const asset = {
      acquisitionValue: new Prisma.Decimal('1000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      usefulLifeYears: 3,
      serviceStartDate: new Date(Date.UTC(2026, 0, 1)),
    };
    const fiscalYears = [2026, 2027, 2028].map((y) => fiscalYear(`fy-${y}`, y));

    const schedule = computeDecliningSchedule(asset, fiscalYears);

    // taux dégressif = (1/3)*1.25 = 41.666...%
    // Y1: max(1000*.41666=416.67, 1000/3=333.33) = 416.67 → vnc 583.33
    // Y2: max(583.33*.41666=243.05, 583.33/2=291.67) = 291.67 (switch!) → vnc 291.66
    // Y3 (last): 1000.00 - 708.34 = 291.66
    expect(schedule.map((line) => line.amount.toApiString())).toEqual([
      '416.67',
      '291.67',
      '291.66',
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
      usefulLifeYears: 5,
      serviceStartDate: new Date(Date.UTC(2026, 0, 1)),
    };
    const fiscalYears = [2026, 2027, 2028, 2029, 2030].map((y) => fiscalYear(`fy-${y}`, y));

    const schedule = computeDecliningSchedule(asset, fiscalYears);
    // base = 9000.00, taux dégressif still 35% of the (base-scaled) vnc.
    expect(schedule[0].amount.toApiString()).toBe('3150.00'); // 9000*0.35
    const total = schedule.reduce(
      (sum, line) => sum.plus(line.amount),
      schedule[0].amount.times(0),
    );
    expect(total.toApiString()).toBe('9000.00');
  });

  it('throws rather than approximate a mid-year acquisition (prorata temporis unimplemented)', () => {
    const asset = {
      acquisitionValue: new Prisma.Decimal('1000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      usefulLifeYears: 3,
      serviceStartDate: new Date(Date.UTC(2026, 5, 15)), // mid-year
    };
    const fiscalYears = [fiscalYear('fy-2026', 2026)];

    expect(() => computeDecliningSchedule(asset, fiscalYears)).toThrow(/prorata temporis/);
  });

  it('throws when the depreciable base is not positive', () => {
    const asset = {
      acquisitionValue: new Prisma.Decimal('1000.00'),
      residualValue: new Prisma.Decimal('1000.00'),
      usefulLifeYears: 5,
      serviceStartDate: new Date(Date.UTC(2026, 0, 1)),
    };
    expect(() => computeDecliningSchedule(asset, [])).toThrow(/positive/);
  });

  it('throws when usefulLifeYears is under 3 (dégressif does not apply)', () => {
    const asset = {
      acquisitionValue: new Prisma.Decimal('1000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      usefulLifeYears: 2,
      serviceStartDate: new Date(Date.UTC(2026, 0, 1)),
    };
    expect(() => computeDecliningSchedule(asset, [])).toThrow(/at least 3 years/);
  });
});
