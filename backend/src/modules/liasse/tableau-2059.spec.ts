import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { computeTableau2059A } from './tableau-2059';

const FY_2026 = { startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') };

describe('computeTableau2059A', () => {
  it('returns an empty table with the "no cession" note when there are no disposals this year', () => {
    const result = computeTableau2059A([], FY_2026);
    expect(result.cadreA).toEqual([]);
    expect(result.cadreB).toEqual([]);
    expect(result.totalCourtTerme).toBe('0.00');
    expect(result.totalLongTerme).toBe('0.00');
    expect(result.totalNonQualifie).toBe('0.00');
    expect(result.note).toMatch(/Aucune cession/);
  });

  it('computes Cadre A (valeur d\'origine / amortissements / valeur résiduelle) for a real disposal', () => {
    const result = computeTableau2059A(
      [
        {
          accountNumber: '218200',
          cessionDate: new Date('2026-07-01'),
          cessionPrice: Money.fromString('9000.00'),
          valeurBrute: Money.fromString('12000.00'),
          amortissementsCumules: Money.fromString('4508.33'),
        },
      ],
      FY_2026,
    );
    expect(result.cadreA).toEqual([
      { accountNumber: '218200', valeurOrigine: '12000.00', amortissements: '4508.33', valeurResiduelle: '7491.67' },
    ]);
  });

  it("computes Cadre B (prix de vente / montant global de la plus-value) with qualification left null", () => {
    const result = computeTableau2059A(
      [
        {
          accountNumber: '218200',
          cessionDate: new Date('2026-07-01'),
          cessionPrice: Money.fromString('9000.00'),
          valeurBrute: Money.fromString('12000.00'),
          amortissementsCumules: Money.fromString('4508.33'),
        },
      ],
      FY_2026,
    );
    expect(result.cadreB).toEqual([
      { accountNumber: '218200', prixDeVente: '9000.00', plusOuMoinsValue: '1508.33', qualification: null },
    ]);
    expect(result.note).toMatch(/qualification fiscale/);
  });

  it('computes a moins-value (negative plusOuMoinsValue) when cessionPrice is below VNC', () => {
    const result = computeTableau2059A(
      [
        {
          accountNumber: '218200',
          cessionDate: new Date('2026-07-01'),
          cessionPrice: Money.fromString('5000.00'),
          valeurBrute: Money.fromString('12000.00'),
          amortissementsCumules: Money.fromString('4508.33'),
        },
      ],
      FY_2026,
    );
    expect(result.cadreB[0].plusOuMoinsValue).toBe('-2491.67');
  });

  it('sums totalNonQualifie across multiple disposals in the same year, while totalCourtTerme/totalLongTerme stay 0,00', () => {
    const result = computeTableau2059A(
      [
        {
          accountNumber: '218200',
          cessionDate: new Date('2026-07-01'),
          cessionPrice: Money.fromString('9000.00'),
          valeurBrute: Money.fromString('12000.00'),
          amortissementsCumules: Money.fromString('4508.33'),
        },
        {
          accountNumber: '218300',
          cessionDate: new Date('2026-03-01'),
          cessionPrice: Money.fromString('100.00'),
          valeurBrute: Money.fromString('6000.00'),
          amortissementsCumules: Money.fromString('6000.00'),
        },
      ],
      FY_2026,
    );
    // Disposal 1: +1508.33. Disposal 2: 100.00 - 0.00 (fully depreciated) = +100.00. Total 1608.33.
    expect(result.totalNonQualifie).toBe('1608.33');
    expect(result.totalCourtTerme).toBe('0.00');
    expect(result.totalLongTerme).toBe('0.00');
  });

  it('throws if a disposal is passed with a cessionDate outside the reported fiscal year', () => {
    expect(() =>
      computeTableau2059A(
        [
          {
            accountNumber: '218200',
            cessionDate: new Date('2025-07-01'),
            cessionPrice: Money.fromString('9000.00'),
            valeurBrute: Money.fromString('12000.00'),
            amortissementsCumules: Money.fromString('4508.33'),
          },
        ],
        FY_2026,
      ),
    ).toThrow(ConflictException);
  });
});
