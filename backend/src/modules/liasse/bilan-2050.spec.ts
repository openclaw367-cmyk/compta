import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import { computeBilan2050, resolveImmobilisationLineCode } from './bilan-2050';
import { buildTrialBalance, LiasseLigne } from './trial-balance-engine';
import { ORACLE_BILAN_LIGNES, ORACLE_HN } from './liasse-oracle-fixture';

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function actifLigne(result: ReturnType<typeof computeBilan2050>, code: string) {
  const ligne = result.actif.find((l) => l.code === code);
  if (!ligne) {
    throw new Error(`No actif line ${code}`);
  }
  return ligne;
}

function passifMontant(result: ReturnType<typeof computeBilan2050>, code: string): string {
  const ligne = result.passif.find((l) => l.code === code);
  if (!ligne) {
    throw new Error(`No passif line ${code}`);
  }
  return ligne.montant;
}

describe('computeBilan2050', () => {
  it('matches the hand-computed oracle (liasse-oracle-fixture.ts) — every populated line asserted, and balances', () => {
    // Hand-computed (see liasse-oracle-fixture.ts's doc comment for the full transaction list):
    //   Actif: AN brut=30000/amort=0/net=30000 (211000, terrain)
    //          AP brut=100000/amort=5000/net=95000 (213000/281300, construction)
    //          AT brut=12000/amort=3000/net=9000 (218300/281800, matériel)
    //          BT brut=18000/amort=0/net=18000 (370000, stock marchandises)
    //          BX brut=15000/amort=0/net=15000 (411000, clients: 36000-21000)
    //          CF brut=33900/amort=0/net=33900 (512000, via dual-nature — net debit)
    //   totalActifBrut = 30000+100000+12000+18000+15000+33900 = 208900.00
    //   totalActifAmortissements = 5000+3000 = 8000.00
    //   totalActifNet = 200900.00
    //
    //   Passif: DA=120000 (101000, capital)
    //           DD=2000 (106100, réserve légale)
    //           DH=3000 (110000, report à nouveau)
    //           DP=5000 (151100, provisions pour risques)
    //           DU=43000 (164000: 40000 fixed + 514000 dual-nature credit 3000 — overdraft)
    //           DX=7000 (401000: 18000+9000-17000-3000)
    //           DY=17000 (445710:6000 + 431000:6000 + 444000:4000 + 428000 dual-nature credit:1000)
    //           DZ=40000 (404000)
    //   totalPassifExcludingResultat = 120000+2000+3000+5000+43000+7000+17000+40000 = 237000.00
    //   DI = HN = -36100.00 (loss, from compte-resultat-2052-2053.spec.ts's oracle)
    //   totalPassif = 237000 - 36100 = 200900.00
    //
    //   totalActifNet (200900.00) === totalPassif (200900.00) — balances.
    const trialBalance = buildTrialBalance(ORACLE_BILAN_LIGNES);
    const result = computeBilan2050(trialBalance, Money.fromString(ORACLE_HN));

    expect(actifLigne(result, 'AN')).toMatchObject({
      brut: '30000.00',
      amortissements: '0.00',
      net: '30000.00',
    });
    expect(actifLigne(result, 'AP')).toMatchObject({
      brut: '100000.00',
      amortissements: '5000.00',
      net: '95000.00',
    });
    expect(actifLigne(result, 'AT')).toMatchObject({
      brut: '12000.00',
      amortissements: '3000.00',
      net: '9000.00',
    });
    expect(actifLigne(result, 'BT')).toMatchObject({
      brut: '18000.00',
      amortissements: '0.00',
      net: '18000.00',
    });
    expect(actifLigne(result, 'BX')).toMatchObject({
      brut: '15000.00',
      amortissements: '0.00',
      net: '15000.00',
    });
    expect(actifLigne(result, 'CF')).toMatchObject({
      brut: '33900.00',
      amortissements: '0.00',
      net: '33900.00',
    });
    // Every other actif line should be zero — the fixture doesn't touch them.
    for (const ligne of result.actif) {
      if (!['AN', 'AP', 'AT', 'BT', 'BX', 'CF'].includes(ligne.code)) {
        expect(ligne).toMatchObject({ brut: '0.00', amortissements: '0.00', net: '0.00' });
      }
    }
    expect(result.totalActifBrut).toBe('208900.00');
    expect(result.totalActifAmortissements).toBe('8000.00');
    expect(result.totalActifNet).toBe('200900.00');

    expect(passifMontant(result, 'DA')).toBe('120000.00');
    expect(passifMontant(result, 'DD')).toBe('2000.00');
    expect(passifMontant(result, 'DH')).toBe('3000.00');
    expect(passifMontant(result, 'DP')).toBe('5000.00');
    expect(passifMontant(result, 'DU')).toBe('43000.00');
    expect(passifMontant(result, 'DX')).toBe('7000.00');
    expect(passifMontant(result, 'DY')).toBe('17000.00');
    expect(passifMontant(result, 'DZ')).toBe('40000.00');
    for (const ligne of result.passif) {
      if (!['DA', 'DD', 'DH', 'DP', 'DU', 'DX', 'DY', 'DZ'].includes(ligne.code)) {
        expect(ligne.montant).toBe('0.00');
      }
    }
    expect(result.resultatDeLExercice).toBe(ORACLE_HN);
    expect(result.totalPassif).toBe('200900.00');
    expect(result.totalActifNet).toBe(result.totalPassif); // the independent bilan-balances check
  });

  it('sign-reclassifies a bank account from actif (CF) to passif (DU) when it ends in overdraft, and vice versa', () => {
    const overdraft: LiasseLigne[] = [
      { compteNumber: '512000', pcgClass: 5, debit: d('0.00'), credit: d('500.00') },
    ];
    const overdraftResult = computeBilan2050(buildTrialBalance(overdraft), Money.zero());
    expect(actifLigne(overdraftResult, 'CF').brut).toBe('0.00');
    expect(passifMontant(overdraftResult, 'DU')).toBe('500.00');

    const inCredit: LiasseLigne[] = [
      { compteNumber: '512000', pcgClass: 5, debit: d('500.00'), credit: d('0.00') },
    ];
    const inCreditResult = computeBilan2050(buildTrialBalance(inCredit), Money.zero());
    expect(actifLigne(inCreditResult, 'CF').brut).toBe('500.00');
    expect(passifMontant(inCreditResult, 'DU')).toBe('0.00');
  });

  it('allows report à nouveau (DH) to be negative — an accumulated deficit is not an error', () => {
    const lignes: LiasseLigne[] = [
      { compteNumber: '119000', pcgClass: 1, debit: d('4000.00'), credit: d('0.00') },
      { compteNumber: '110000', pcgClass: 1, debit: d('0.00'), credit: d('1000.00') },
    ];
    const result = computeBilan2050(buildTrialBalance(lignes), Money.zero());
    expect(passifMontant(result, 'DH')).toBe('-3000.00');
  });

  it('sets DI from the value passed in, not from a ledger account 12 read', () => {
    // No 120000/129000 lines in the input at all — DI must still reflect the passed-in result.
    const result = computeBilan2050([], Money.fromString('1234.56'));
    expect(result.resultatDeLExercice).toBe('1234.56');
    expect(result.totalPassif).toBe('1234.56');
  });

  it('refuses an account with no bilan line mapping (478 "autres comptes transitoires", deliberately deferred)', () => {
    const lignes: LiasseLigne[] = [
      { compteNumber: '478000', pcgClass: 4, debit: d('10.00'), credit: d('0.00') },
    ];
    expect(() => computeBilan2050(buildTrialBalance(lignes), Money.zero())).toThrow(
      /no liasse line mapping/,
    );
  });
});

describe('resolveImmobilisationLineCode', () => {
  it('resolves a class-2 account to its Actif line, for the VNC cross-check', () => {
    expect(resolveImmobilisationLineCode('213000')).toBe('AP');
    expect(resolveImmobilisationLineCode('218300')).toBe('AT');
  });

  it('throws for an immobilisation account outside the mapped ranges', () => {
    expect(() => resolveImmobilisationLineCode('229999')).toThrow(/no Actif line mapping/);
  });
});
