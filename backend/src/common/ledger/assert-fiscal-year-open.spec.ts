import { BadRequestException } from '@nestjs/common';
import { assertFiscalYearOpen } from './assert-fiscal-year-open';

describe('assertFiscalYearOpen', () => {
  it('does nothing for an open fiscal year', () => {
    expect(() => assertFiscalYearOpen({ label: '2026', closedAt: null })).not.toThrow();
  });

  it('throws BadRequestException naming the fiscal year for a closed one', () => {
    expect(() => assertFiscalYearOpen({ label: '2026', closedAt: new Date() })).toThrow(
      BadRequestException,
    );
    expect(() => assertFiscalYearOpen({ label: '2026', closedAt: new Date() })).toThrow(/2026/);
  });
});
