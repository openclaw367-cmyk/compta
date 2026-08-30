import { Money } from '../../common/decimal';
import { traceTableau2059Column } from './tableau-2059-trace';

describe('traceTableau2059Column', () => {
  it('traces valeurOrigine to the gross account', () => {
    const result = traceTableau2059Column(
      'asset-1',
      '218200',
      '281820',
      Money.fromString('12000.00'),
      Money.fromString('4508.33'),
      Money.fromString('9000.00'),
      'valeurOrigine',
    );
    expect(result).toEqual({
      assetId: 'asset-1',
      column: 'valeurOrigine',
      columnValue: '12000.00',
      accountNumber: '218200',
    });
  });

  it('traces amortissements to the depreciation account', () => {
    const result = traceTableau2059Column(
      'asset-1',
      '218200',
      '281820',
      Money.fromString('12000.00'),
      Money.fromString('4508.33'),
      Money.fromString('9000.00'),
      'amortissements',
    );
    expect(result).toEqual({
      assetId: 'asset-1',
      column: 'amortissements',
      columnValue: '4508.33',
      accountNumber: '281820',
    });
  });

  it('traces prixDeVente to the CORPORELLE produit account (775200) for a 21x/218x asset, reusing resolveCessionNature — never guessed', () => {
    const result = traceTableau2059Column(
      'asset-1',
      '218200',
      '281820',
      Money.fromString('12000.00'),
      Money.fromString('4508.33'),
      Money.fromString('9000.00'),
      'prixDeVente',
    );
    expect(result).toEqual({
      assetId: 'asset-1',
      column: 'prixDeVente',
      columnValue: '9000.00',
      accountNumber: '775200',
    });
  });

  it('traces prixDeVente to the INCORPORELLE produit account (775100) for a 20x asset', () => {
    const result = traceTableau2059Column(
      'asset-2',
      '207000',
      '280700',
      Money.fromString('5000.00'),
      Money.fromString('2000.00'),
      Money.fromString('4000.00'),
      'prixDeVente',
    );
    expect(result.accountNumber).toBe('775100');
  });

  it("propagates resolveCessionNature's own refusal for a financière (26x/27x) account rather than silently mapping it", () => {
    expect(() =>
      traceTableau2059Column(
        'asset-3',
        '261000',
        '296100',
        Money.fromString('1000.00'),
        Money.fromString('0.00'),
        Money.fromString('1000.00'),
        'prixDeVente',
      ),
    ).toThrow(/financial|financière/i);
  });
});
