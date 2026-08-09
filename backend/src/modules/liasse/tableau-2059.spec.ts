import { ConflictException } from '@nestjs/common';
import { computeTableau2059A } from './tableau-2059';

describe('computeTableau2059A', () => {
  it('returns an empty, N/A-shaped table when no FixedAsset has a cessionDate', () => {
    const result = computeTableau2059A([
      { id: 'asset-1', accountNumber: '213000', cessionDate: null },
      { id: 'asset-2', accountNumber: '218300', cessionDate: null },
    ]);
    expect(result.cadreA).toEqual([]);
    expect(result.cadreB).toEqual([]);
    expect(result.totalCourtTerme).toBe('0.00');
    expect(result.totalLongTerme).toBe('0.00');
    expect(result.note).toMatch(/cessions.*ne sont pas encore prises en charge/);
  });

  it('returns the same empty table for zero assets (a fresh company)', () => {
    const result = computeTableau2059A([]);
    expect(result.totalCourtTerme).toBe('0.00');
    expect(result.totalLongTerme).toBe('0.00');
  });

  it('throws rather than silently omitting a real disposal when a FixedAsset has a cessionDate set', () => {
    expect(() =>
      computeTableau2059A([
        { id: 'asset-1', accountNumber: '213000', cessionDate: null },
        { id: 'asset-2', accountNumber: '218300', cessionDate: new Date('2026-06-01') },
      ]),
    ).toThrow(ConflictException);
  });

  it('names the offending account in the guard message', () => {
    expect(() =>
      computeTableau2059A([
        { id: 'asset-2', accountNumber: '218300', cessionDate: new Date('2026-06-01') },
      ]),
    ).toThrow(/218300/);
  });
});
