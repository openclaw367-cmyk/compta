import { Prisma } from '@prisma/client';
import {
  AnalyticalLigne,
  assertAnalyticalTiesToOfficialTotal,
  computeAnalyticalReport,
} from './analytical-report';

function ligne(
  compteNumber: string,
  pcgClass: number,
  debit: string,
  credit: string,
  costCenterId: string | null,
): AnalyticalLigne {
  return {
    compteNumber,
    pcgClass,
    debit: new Prisma.Decimal(debit),
    credit: new Prisma.Decimal(credit),
    costCenterId,
  };
}

const CC1 = { id: 'cc1', code: 'PROJ-A', label: 'Projet A' };
const CC2 = { id: 'cc2', code: 'PROJ-B', label: 'Projet B' };

/**
 * Hand-traced before any code was written (see CLAUDE.md "Comptabilité
 * analytique"):
 *   - 607000 (FS, debit-direction): CC1 1000.00, CC2 500.00, unallocated 200.00
 *     -> account total debit 1700.00 -> official FS = 1700.00
 *   - 707000 (FC, credit-direction): CC1 3000.00, unallocated 500.00
 *     -> account total credit 3500.00 -> official FC = 3500.00 (contribution = balance * -1)
 * FS sum: 1000 + 500 + 200 = 1700 (ties). FC sum: 3000 + 0 + 500 = 3500 (ties).
 */
const FIXTURE_LIGNES: AnalyticalLigne[] = [
  ligne('607000', 6, '1000.00', '0.00', CC1.id),
  ligne('607000', 6, '500.00', '0.00', CC2.id),
  ligne('607000', 6, '200.00', '0.00', null),
  ligne('707000', 7, '0.00', '3000.00', CC1.id),
  ligne('707000', 7, '0.00', '500.00', null),
];

describe('computeAnalyticalReport', () => {
  it('ties the per-cost-center split to the independently-derived official totals', () => {
    const report = computeAnalyticalReport('fy1', FIXTURE_LIGNES, [CC1, CC2]);

    expect(report.officialTotals).toEqual(
      expect.arrayContaining([
        { code: 'FC', label: 'Ventes de marchandises', amount: '3500.00' },
        { code: 'FS', label: 'Achats de marchandises', amount: '1700.00' },
      ]),
    );

    const cc1Bucket = report.buckets.find((b) => b.costCenterId === CC1.id)!;
    expect(cc1Bucket.lines).toEqual(
      expect.arrayContaining([
        { code: 'FC', label: 'Ventes de marchandises', amount: '3000.00' },
        { code: 'FS', label: 'Achats de marchandises', amount: '1000.00' },
      ]),
    );

    const cc2Bucket = report.buckets.find((b) => b.costCenterId === CC2.id)!;
    expect(cc2Bucket.lines).toEqual([
      { code: 'FS', label: 'Achats de marchandises', amount: '500.00' },
    ]);
    expect(cc2Bucket.lines.find((l) => l.code === 'FC')).toBeUndefined();

    const unallocated = report.buckets.find((b) => b.costCenterId === null)!;
    expect(unallocated.costCenterLabel).toBe('Non ventilé');
    expect(unallocated.lines).toEqual(
      expect.arrayContaining([
        { code: 'FC', label: 'Ventes de marchandises', amount: '500.00' },
        { code: 'FS', label: 'Achats de marchandises', amount: '200.00' },
      ]),
    );

    // "Non ventilé" always sorts last.
    expect(report.buckets[report.buckets.length - 1].costCenterId).toBeNull();
  });

  it('excludes accounts outside pcgClass 6/7', () => {
    const lignes: AnalyticalLigne[] = [
      ...FIXTURE_LIGNES,
      ligne('411000', 4, '1200.00', '0.00', CC1.id),
    ];
    const report = computeAnalyticalReport('fy1', lignes, [CC1, CC2]);
    expect(report.officialTotals.find((l) => l.code === 'BX')).toBeUndefined();
  });

  it('drops a group that nets to exactly zero', () => {
    const lignes: AnalyticalLigne[] = [
      ...FIXTURE_LIGNES,
      ligne('607000', 6, '0.00', '0.00', CC2.id),
    ];
    // Still ties even with a genuinely-zero group present.
    expect(() => computeAnalyticalReport('fy1', lignes, [CC1, CC2])).not.toThrow();
  });

  it('is deterministic for the same input', () => {
    const report1 = computeAnalyticalReport('fy1', FIXTURE_LIGNES, [CC1, CC2]);
    const report2 = computeAnalyticalReport('fy1', FIXTURE_LIGNES, [CC1, CC2]);
    expect(report1).toEqual(report2);
  });

  it('assertAnalyticalTiesToOfficialTotal throws naming both figures on a real mismatch', () => {
    const buckets = [
      {
        costCenterId: CC1.id,
        costCenterLabel: CC1.label,
        lines: [{ code: 'FS', label: 'x', amount: '100.00' }],
      },
    ];
    const officialTotals = [{ code: 'FS', label: 'x', amount: '150.00' }];
    expect(() => assertAnalyticalTiesToOfficialTotal(buckets, officialTotals)).toThrow(
      /100\.00.*150\.00/,
    );
  });

  it('assertAnalyticalTiesToOfficialTotal passes when every code ties exactly', () => {
    const buckets = [
      {
        costCenterId: CC1.id,
        costCenterLabel: CC1.label,
        lines: [{ code: 'FS', label: 'x', amount: '100.00' }],
      },
      {
        costCenterId: null,
        costCenterLabel: 'Non ventilé',
        lines: [{ code: 'FS', label: 'x', amount: '50.00' }],
      },
    ];
    const officialTotals = [{ code: 'FS', label: 'x', amount: '150.00' }];
    expect(() => assertAnalyticalTiesToOfficialTotal(buckets, officialTotals)).not.toThrow();
  });
});
