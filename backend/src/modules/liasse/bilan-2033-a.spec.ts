import { Money } from '../../common/decimal';
import { computeBilan2033A } from './bilan-2033-a';
import { computeBilan2050 } from './bilan-2050';
import { assertBilan2033ABalances } from './liasse-articulation';
import { buildTrialBalance } from './trial-balance-engine';
import { ORACLE_BILAN_LIGNES, ORACLE_HN } from './liasse-oracle-fixture';

function actifLigne(result: ReturnType<typeof computeBilan2033A>, code: string) {
  const ligne = result.actif.find((l) => l.code === code);
  if (!ligne) {
    throw new Error(`No actif line ${code}`);
  }
  return ligne;
}

function passifMontant(result: ReturnType<typeof computeBilan2033A>, code: string): string {
  const ligne = result.passif.find((l) => l.code === code);
  if (!ligne) {
    throw new Error(`No passif line ${code}`);
  }
  return ligne.montant;
}

describe('computeBilan2033A', () => {
  it('matches the hand-computed oracle (liasse-oracle-fixture.ts, same dataset as the 2050 pass) and balances', () => {
    // Hand-computed — see liasse-oracle-fixture.ts and bilan-2050.spec.ts's own oracle derivation
    // for the underlying transactions; this form just groups the SAME accounts more coarsely:
    //   028 (211000+213000+218300) brut=142000.00, amort (281300+281800)=8000.00, net=134000.00
    //   060 (370000) brut=18000.00
    //   068 (411000) brut=15000.00 (36000-21000)
    //   084 (512000, dual-nature net debit) = 33900.00
    //   totalActifBrut = 142000+18000+15000+33900 = 208900.00
    //   totalActifAmortissements = 8000.00
    //   totalActifNet = 200900.00
    //
    //   120 (101000) = 120000.00, 126 (106100) = 2000.00, 134 (110000) = 3000.00
    //   totalIPassifExcludingResultat = 125000.00
    //   154 (151100, Provisions pour risques et charges) = 5000.00
    //   156 (164000 + 514000 dual-nature credit) = 40000+3000 = 43000.00
    //   166 (401000 + 404000, no dedicated "dettes sur immobilisations" line on this form) = 7000+40000 = 47000.00
    //   172 (445710+431000+444000+428000 dual-nature credit) = 6000+6000+4000+1000 = 17000.00
    //   totalIIIPassif = 43000+47000+17000 = 107000.00
    //   totalPassif = 125000 + (-36100) + 5000 + 107000 = 200900.00 — balances, matches totalActifNet.
    const trialBalance = buildTrialBalance(ORACLE_BILAN_LIGNES);
    const result = computeBilan2033A(trialBalance, Money.fromString(ORACLE_HN));

    expect(actifLigne(result, '028')).toMatchObject({
      brut: '142000.00',
      amortissements: '8000.00',
      net: '134000.00',
    });
    expect(actifLigne(result, '060')).toMatchObject({ brut: '18000.00', net: '18000.00' });
    expect(actifLigne(result, '068')).toMatchObject({ brut: '15000.00', net: '15000.00' });
    expect(actifLigne(result, '084')).toMatchObject({ brut: '33900.00', net: '33900.00' });
    expect(result.totalActifBrut).toBe('208900.00');
    expect(result.totalActifAmortissements).toBe('8000.00');
    expect(result.totalActifNet).toBe('200900.00');

    expect(passifMontant(result, '120')).toBe('120000.00');
    expect(passifMontant(result, '126')).toBe('2000.00');
    expect(passifMontant(result, '134')).toBe('3000.00');
    expect(result.totalIPassifExcludingResultat).toBe('125000.00');
    expect(result.totalIIPassif).toBe('5000.00');
    expect(result.totalIIIPassif).toBe('107000.00');
    expect(result.resultatDeLExercice).toBe(ORACLE_HN);
    expect(result.totalPassif).toBe('200900.00');

    expect(() => assertBilan2033ABalances(result)).not.toThrow();
  });

  it('reconciles to the same trial balance the 2050 series reads — independently-specified rule tables, same accounts, same grand totals despite coarser line codes', () => {
    const trialBalance = buildTrialBalance(ORACLE_BILAN_LIGNES);
    const simplifie = computeBilan2033A(trialBalance, Money.fromString(ORACLE_HN));
    const normal = computeBilan2050(trialBalance, Money.fromString(ORACLE_HN));

    expect(simplifie.totalActifBrut).toBe(normal.totalActifBrut);
    expect(simplifie.totalActifAmortissements).toBe(normal.totalActifAmortissements);
    expect(simplifie.totalActifNet).toBe(normal.totalActifNet);
    expect(simplifie.totalPassif).toBe(normal.totalPassif);
  });

  it('throws on an account with no 2033-A line mapping', () => {
    const ligne = {
      compteNumber: '476000',
      pcgClass: 4,
      debit: Money.fromString('100.00').toDecimal(),
      credit: Money.fromString('0.00').toDecimal(),
    };
    const trialBalance = buildTrialBalance([ligne]);
    expect(() => computeBilan2033A(trialBalance, Money.zero())).toThrow();
  });

  it('assertBilan2033ABalances throws when Actif ≠ Passif', () => {
    expect(() =>
      assertBilan2033ABalances({
        actif: [],
        totalIActifBrut: '0.00',
        totalIActifAmortissements: '0.00',
        totalIIActifBrut: '0.00',
        totalIIActifAmortissements: '0.00',
        totalActifBrut: '100.00',
        totalActifAmortissements: '0.00',
        totalActifNet: '100.00',
        passif: [],
        totalIPassifExcludingResultat: '0.00',
        resultatDeLExercice: '0.00',
        totalIIPassif: '0.00',
        totalIIIPassif: '0.00',
        totalPassif: '50.00',
      }),
    ).toThrow();
  });
});
