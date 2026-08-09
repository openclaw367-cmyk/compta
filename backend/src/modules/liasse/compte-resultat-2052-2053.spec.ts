import { Prisma } from '@prisma/client';
import { computeCompteResultat2052_2053 } from './compte-resultat-2052-2053';
import { buildTrialBalance, LiasseLigne } from './trial-balance-engine';
import { ORACLE_CDR_LIGNES, ORACLE_HN } from './liasse-oracle-fixture';

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('computeCompteResultat2052_2053', () => {
  it('matches the hand-computed oracle (liasse-oracle-fixture.ts) — every line asserted', () => {
    // Hand-computed (see liasse-oracle-fixture.ts's doc comment for the full transaction list):
    //   FC=30000.00 (707000)                         FR = 30000.00
    //   FU=9000.00 (601000), FW=11000.00 (613+616+622600),
    //   FY=21000.00 (641000: 20000+1000), FZ=8000.00 (645000),
    //   GA=8000.00 (681100), GD=5000.00 (681500)      GF = 62000.00
    //   GG = FR - GF = 30000 - 62000 = -32000.00
    //   GL=900.00 (764000)                            GP = 900.00
    //   GR=1200.00 (661000)                            GU = 1200.00
    //   GV = 900 - 1200 = -300.00
    //   GW = GG + 0 - 0 + GV = -32000 - 300 = -32300.00
    //   HD=500.00 (771000), HH=300.00 (671000)         HI = 200.00
    //   HK=4000.00 (695000)
    //   HL = FR + 0 + GP + HD = 30000 + 900 + 500 = 31400.00
    //   HM = GF + 0 + GU + HH + 0 + HK = 62000 + 1200 + 300 + 4000 = 67500.00
    //   HN = HL - HM = 31400 - 67500 = -36100.00 (perte)
    const trialBalance = buildTrialBalance(ORACLE_CDR_LIGNES);
    const result = computeCompteResultat2052_2053(trialBalance);

    expect(result.totalProduitsExploitation).toBe('30000.00'); // FR
    expect(result.totalChargesExploitation).toBe('62000.00'); // GF
    expect(result.resultatExploitation).toBe('-32000.00'); // GG
    expect(result.beneficeAttribueOuPerteTransferee).toBeNull(); // GH — deferred
    expect(result.perteSupporteeOuBeneficeTransfere).toBeNull(); // GI — deferred
    expect(result.totalProduitsFinanciers).toBe('900.00'); // GP
    expect(result.totalChargesFinancieres).toBe('1200.00'); // GU
    expect(result.resultatFinancier).toBe('-300.00'); // GV
    expect(result.resultatCourantAvantImpots).toBe('-32300.00'); // GW
    expect(result.resultatExceptionnel).toBe('200.00'); // HI
    expect(result.totalProduits).toBe('31400.00'); // HL
    expect(result.totalCharges).toBe('67500.00'); // HM
    expect(result.beneficeOuPerte).toBe(ORACLE_HN); // HN
  });

  it('reports zero for every unused line rather than omitting it', () => {
    const lignes: LiasseLigne[] = [
      { compteNumber: '707000', pcgClass: 7, debit: d('0.00'), credit: d('1000.00') },
    ];
    const result = computeCompteResultat2052_2053(buildTrialBalance(lignes));
    expect(result.totalChargesExploitation).toBe('0.00');
    expect(result.totalProduitsFinanciers).toBe('0.00');
    expect(result.resultatExceptionnel).toBe('0.00');
  });

  it('nets a contra account (rabais obtenus) against its parent achat line without special-casing', () => {
    const lignes: LiasseLigne[] = [
      { compteNumber: '601000', pcgClass: 6, debit: d('1000.00'), credit: d('0.00') },
      { compteNumber: '6091', pcgClass: 6, debit: d('0.00'), credit: d('150.00') },
    ];
    const result = computeCompteResultat2052_2053(buildTrialBalance(lignes));
    expect(result.totalChargesExploitation).toBe('850.00'); // FU = 1000 - 150
  });

  it('allows déstockage (variation de stocks) to be negative', () => {
    const lignes: LiasseLigne[] = [
      { compteNumber: '6037', pcgClass: 6, debit: d('0.00'), credit: d('200.00') },
    ];
    const result = computeCompteResultat2052_2053(buildTrialBalance(lignes));
    expect(result.totalChargesExploitation).toBe('-200.00'); // FT allowed negative
  });

  it('refuses an account with no compte-de-résultat line mapping', () => {
    const lignes: LiasseLigne[] = [
      { compteNumber: '655100', pcgClass: 6, debit: d('500.00'), credit: d('0.00') },
    ];
    expect(() => computeCompteResultat2052_2053(buildTrialBalance(lignes))).toThrow(
      /no liasse line mapping/,
    );
  });

  it('refuses a line that unexpectedly nets negative', () => {
    // 641 (Salaires) is debit-normal and not allowed negative — an unusual credit-heavy posting
    // (e.g. a large correction) should be refused, not silently reported as a negative charge.
    const lignes: LiasseLigne[] = [
      { compteNumber: '641000', pcgClass: 6, debit: d('0.00'), credit: d('100.00') },
    ];
    expect(() => computeCompteResultat2052_2053(buildTrialBalance(lignes))).toThrow(/negative/);
  });
});
