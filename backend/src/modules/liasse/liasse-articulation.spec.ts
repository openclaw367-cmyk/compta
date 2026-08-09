import { Money } from '../../common/decimal';
import { computeBilan2050 } from './bilan-2050';
import { buildTrialBalance } from './trial-balance-engine';
import { ORACLE_BILAN_LIGNES, ORACLE_HN } from './liasse-oracle-fixture';
import { VncCheckLine, assertLiasseArticulation } from './liasse-articulation';

describe('assertLiasseArticulation', () => {
  it('passes for the balanced oracle bilan with a matching VNC', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const vncByLine: VncCheckLine[] = [
      {
        code: 'AP',
        valeurBrute: Money.fromString('100000.00'),
        amortissementsCumules: Money.fromString('5000.00'),
      },
      {
        code: 'AT',
        valeurBrute: Money.fromString('12000.00'),
        amortissementsCumules: Money.fromString('3000.00'),
      },
    ];
    expect(() => assertLiasseArticulation({ bilan, vncByLine })).not.toThrow();
  });

  it('throws when Actif net does not equal Passif total', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const brokenBilan = { ...bilan, totalActifNet: '999999.99' };
    expect(() => assertLiasseArticulation({ bilan: brokenBilan, vncByLine: [] })).toThrow(
      /does not balance/,
    );
  });

  it('throws when the immobilisations module VNC diverges from the ledger-derived Brut', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const wrongVnc: VncCheckLine[] = [
      {
        code: 'AP',
        valeurBrute: Money.fromString('50000.00'),
        amortissementsCumules: Money.fromString('5000.00'),
      },
    ];
    expect(() => assertLiasseArticulation({ bilan, vncByLine: wrongVnc })).toThrow(
      /valeur brute.*≠ ledger-derived Brut/,
    );
  });

  it('throws when the immobilisations module VNC diverges from the ledger-derived Amortissements', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const wrongVnc: VncCheckLine[] = [
      {
        code: 'AP',
        valeurBrute: Money.fromString('100000.00'),
        amortissementsCumules: Money.fromString('9999.00'),
      },
    ];
    expect(() => assertLiasseArticulation({ bilan, vncByLine: wrongVnc })).toThrow(
      /amortissements cumulés.*≠ ledger-derived Amortissements/,
    );
  });

  it('ignores a VNC line for a bilan code that has no matching actif row (defensive, should not happen in practice)', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const orphanVnc: VncCheckLine[] = [
      {
        code: 'ZZ',
        valeurBrute: Money.fromString('1.00'),
        amortissementsCumules: Money.fromString('0.00'),
      },
    ];
    expect(() => assertLiasseArticulation({ bilan, vncByLine: orphanVnc })).not.toThrow();
  });
});
