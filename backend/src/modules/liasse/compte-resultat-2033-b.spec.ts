import { Money } from '../../common/decimal';
import { computeCompteResultat2033B } from './compte-resultat-2033-b';
import { computeCompteResultat2052_2053 } from './compte-resultat-2052-2053';
import { buildTrialBalance } from './trial-balance-engine';
import { ORACLE_CDR_LIGNES, ORACLE_HN } from './liasse-oracle-fixture';

function montant(result: ReturnType<typeof computeCompteResultat2033B>, code: string): string {
  const ligne = result.lignes.find((l) => l.code === code);
  if (!ligne) {
    throw new Error(`No ligne ${code}`);
  }
  return ligne.montant;
}

describe('computeCompteResultat2033B', () => {
  it('matches the hand-computed oracle (liasse-oracle-fixture.ts, same dataset as the 2052/2053 pass)', () => {
    // Hand-computed (see liasse-oracle-fixture.ts's doc comment for the full transaction list):
    //   210 (707000) = 30000.00
    //   238 (601000) = 9000.00
    //   242 (613000+616000+622600) = 6000+2000+3000 = 11000.00
    //   250 (641000: 20000 salaries T13 + 1000 charge-à-payer T22) = 21000.00
    //   252 (645000) = 8000.00
    //   254 (681100) = 8000.00
    //   256 (681500) = 5000.00
    //   totalProduitsExploitation = 30000.00
    //   totalChargesExploitation = 9000+11000+21000+8000+8000+5000 = 62000.00
    //   resultatExploitation = 30000 - 62000 = -32000.00
    //   280 (764000) = 900.00, 294 (661000) = 1200.00
    //   290 (771000) = 500.00, 300 (671000) = 300.00
    //   306 (695000) = 4000.00
    //   totalProduits = 30000 + 900 + 500 = 31400.00
    //   totalCharges = 62000 + 1200 + 300 + 4000 = 67500.00
    //   beneficeOuPerte = 31400 - 67500 = -36100.00 — matches ORACLE_HN exactly.
    const trialBalance = buildTrialBalance(ORACLE_CDR_LIGNES);
    const result = computeCompteResultat2033B(trialBalance);

    expect(montant(result, '210')).toBe('30000.00');
    expect(montant(result, '238')).toBe('9000.00');
    expect(montant(result, '242')).toBe('11000.00');
    expect(montant(result, '250')).toBe('21000.00');
    expect(montant(result, '252')).toBe('8000.00');
    expect(montant(result, '254')).toBe('8000.00');
    expect(montant(result, '256')).toBe('5000.00');
    expect(montant(result, '280')).toBe('900.00');
    expect(montant(result, '294')).toBe('1200.00');
    expect(montant(result, '290')).toBe('500.00');
    expect(montant(result, '300')).toBe('300.00');
    expect(montant(result, '306')).toBe('4000.00');

    expect(result.totalProduitsExploitation).toBe('30000.00');
    expect(result.totalChargesExploitation).toBe('62000.00');
    expect(result.resultatExploitation).toBe('-32000.00');
    expect(result.beneficeOuPerte).toBe(ORACLE_HN);
  });

  it('reconciles to the same trial balance the 2052/2053 (régime normal) mapping reads — independently-specified rule tables, same accounts, same bottom line', () => {
    const trialBalance = buildTrialBalance(ORACLE_CDR_LIGNES);
    const simplifie = computeCompteResultat2033B(trialBalance);
    const normal = computeCompteResultat2052_2053(trialBalance);

    expect(simplifie.beneficeOuPerte).toBe(normal.beneficeOuPerte);
  });

  it('allows a negative production stockée (déstockage) without throwing', () => {
    const ligne = {
      compteNumber: '713000',
      pcgClass: 7,
      debit: Money.fromString('500.00').toDecimal(),
      credit: Money.fromString('0.00').toDecimal(),
    };
    const trialBalance = buildTrialBalance([ligne]);
    const result = computeCompteResultat2033B(trialBalance);
    expect(montant(result, '222')).toBe('-500.00');
  });

  it('throws on an account with no 2033-B line mapping', () => {
    const ligne = {
      compteNumber: '655000',
      pcgClass: 6,
      debit: Money.fromString('100.00').toDecimal(),
      credit: Money.fromString('0.00').toDecimal(),
    };
    const trialBalance = buildTrialBalance([ligne]);
    expect(() => computeCompteResultat2033B(trialBalance)).toThrow();
  });
});
