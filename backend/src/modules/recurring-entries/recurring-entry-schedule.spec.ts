import { computeNextDueDate } from './recurring-entry-schedule';

describe('computeNextDueDate', () => {
  it('returns null when frequency is unset', () => {
    expect(computeNextDueDate(null, 5, null, null, new Date(2026, 0, 1))).toBeNull();
  });

  it('returns null when anchorDay is unset', () => {
    expect(computeNextDueDate('MONTHLY', null, null, null, new Date(2026, 0, 1))).toBeNull();
  });

  it('returns null for QUARTERLY/YEARLY with no anchorMonth', () => {
    expect(computeNextDueDate('QUARTERLY', 5, null, null, new Date(2026, 0, 1))).toBeNull();
    expect(computeNextDueDate('YEARLY', 5, null, null, new Date(2026, 0, 1))).toBeNull();
  });

  describe('MONTHLY, no lastAppliedAt yet', () => {
    it('shows this month when the anchor day has not passed', () => {
      expect(computeNextDueDate('MONTHLY', 5, null, null, new Date(2026, 0, 3))).toBe('2026-01-05');
    });

    it('shows next month once the anchor day has passed', () => {
      expect(computeNextDueDate('MONTHLY', 5, null, null, new Date(2026, 0, 10))).toBe(
        '2026-02-05',
      );
    });

    it('shows THIS month on the anchor day itself (not yet passed)', () => {
      expect(computeNextDueDate('MONTHLY', 5, null, null, new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('rolls over into the next year', () => {
      expect(computeNextDueDate('MONTHLY', 5, null, null, new Date(2026, 11, 10))).toBe(
        '2027-01-05',
      );
    });

    it('clamps a day beyond the month length (e.g. 31 in February)', () => {
      expect(computeNextDueDate('MONTHLY', 31, null, null, new Date(2026, 1, 1))).toBe(
        '2026-02-28',
      );
    });
  });

  describe('MONTHLY, with lastAppliedAt', () => {
    it('always shows the period AFTER lastAppliedAt, regardless of today', () => {
      expect(
        computeNextDueDate('MONTHLY', 5, null, new Date(2026, 0, 5), new Date(2026, 0, 6)),
      ).toBe('2026-02-05');
    });
  });

  describe('QUARTERLY (calendar-quarter aligned)', () => {
    it('shows this quarter when the anchor date has not passed', () => {
      expect(computeNextDueDate('QUARTERLY', 15, 1, null, new Date(2026, 0, 10))).toBe(
        '2026-01-15',
      );
    });

    it('advances to the next quarter once the anchor date has passed', () => {
      expect(computeNextDueDate('QUARTERLY', 15, 1, null, new Date(2026, 0, 20))).toBe(
        '2026-04-15',
      );
    });

    it('anchorMonth 3 (last month of the quarter)', () => {
      expect(computeNextDueDate('QUARTERLY', 10, 3, null, new Date(2026, 1, 1))).toBe('2026-03-10');
    });

    it('advances one full period after lastAppliedAt', () => {
      expect(
        computeNextDueDate('QUARTERLY', 15, 1, new Date(2026, 0, 15), new Date(2026, 0, 16)),
      ).toBe('2026-04-15');
    });
  });

  describe('YEARLY', () => {
    it('shows this year when the anchor date has not passed', () => {
      expect(computeNextDueDate('YEARLY', 5, 6, null, new Date(2026, 0, 1))).toBe('2026-06-05');
    });

    it('advances to next year once the anchor date has passed', () => {
      expect(computeNextDueDate('YEARLY', 5, 6, null, new Date(2026, 6, 1))).toBe('2027-06-05');
    });

    it('advances one full year after lastAppliedAt', () => {
      expect(computeNextDueDate('YEARLY', 5, 6, new Date(2026, 5, 5), new Date(2026, 5, 6))).toBe(
        '2027-06-05',
      );
    });
  });
});
