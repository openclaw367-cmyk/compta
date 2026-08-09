import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import { computeBilan2050 } from './bilan-2050';
import { LiasseLigne, buildTrialBalance } from './trial-balance-engine';
import { ORACLE_BILAN_LIGNES, ORACLE_HN } from './liasse-oracle-fixture';
import { ProvisionMovementLigne, computeTableau2056 } from './tableau-2056';
import { ORACLE_2056_LIGNES } from './tableau-2056-oracle-fixture';
import { computeTableau2057 } from './tableau-2057';
import { computeTableau2059A } from './tableau-2059';
import { CompteResultat2052_2053, CompteResultatLigne } from './compte-resultat-2052-2053';
import {
  VncCheckLine,
  assertLiasseArticulation,
  assertTableau2056TiesToBilan,
  assertTableau2057TiesToBilan,
  assertTableau2059TiesToCompteResultat,
} from './liasse-articulation';

/** Minimal fake compte de résultat — only `lignes` is read by assertTableau2059TiesToCompteResultat. */
function fakeCompteResultat(lignes: CompteResultatLigne[]): CompteResultat2052_2053 {
  return {
    lignes,
    totalProduitsExploitation: '0.00',
    totalChargesExploitation: '0.00',
    resultatExploitation: '0.00',
    beneficeAttribueOuPerteTransferee: null,
    perteSupporteeOuBeneficeTransfere: null,
    totalProduitsFinanciers: '0.00',
    totalChargesFinancieres: '0.00',
    resultatFinancier: '0.00',
    resultatCourantAvantImpots: '0.00',
    resultatExceptionnel: '0.00',
    totalProduits: '0.00',
    totalCharges: '0.00',
    beneficeOuPerte: '0.00',
  };
}

/**
 * ORACLE_2056_LIGNES as raw ledger lines, for a trial balance that
 * includes the provision accounts. Uses 151200, not 151100 —
 * liasse-oracle-fixture.ts's own ORACLE_BILAN_LIGNES already has a
 * provision on 151100 (its T21, feeding its own DP-line test); reusing
 * that number here would merge with it instead of adding a second,
 * independent provision to the combined trial balance below.
 */
const PROVISION_LEDGER_LIGNES: LiasseLigne[] = [
  {
    compteNumber: '151200',
    pcgClass: 1,
    debit: new Prisma.Decimal('0.00'),
    credit: new Prisma.Decimal('5000.00'),
  },
  {
    compteNumber: '151200',
    pcgClass: 1,
    debit: new Prisma.Decimal('2000.00'),
    credit: new Prisma.Decimal('0.00'),
  },
  {
    compteNumber: '491000',
    pcgClass: 4,
    debit: new Prisma.Decimal('0.00'),
    credit: new Prisma.Decimal('1200.00'),
  },
];

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

/**
 * ORACLE_2056_LIGNES only covers the two NEW provisions (151200,
 * 491000) — it doesn't know about liasse-oracle-fixture.ts's own T21
 * (151100, credit 5000.00, a plain dotation with no reprise). For the
 * tie-out to be meaningful, computeTableau2056's input must cover every
 * provision account actually present in the combined trial balance
 * below, so T21's movement is added here explicitly. Expected combined
 * total: 5000.00 (LITIGES, from T21) + 3000.00 (GARANTIES_CLIENTS) +
 * 1200.00 (DEPREC_COMPTES_CLIENTS) = 9200.00.
 */
const ALL_PROVISION_MOVEMENT_LIGNES: ProvisionMovementLigne[] = [
  {
    accountNumber: '151100',
    isOpeningBalance: false,
    debit: Money.zero(),
    credit: Money.fromString('5000.00'),
  },
  ...ORACLE_2056_LIGNES,
];

describe('assertTableau2056TiesToBilan', () => {
  it('passes when 2056 totalGénéral matches the raw trial-balance sum of provision/dépréciation accounts', () => {
    const trialBalance = buildTrialBalance([...ORACLE_BILAN_LIGNES, ...PROVISION_LEDGER_LIGNES]);
    const tableau2056 = computeTableau2056(ALL_PROVISION_MOVEMENT_LIGNES);
    expect(tableau2056.totalGeneral).toBe('9200.00');
    expect(() => assertTableau2056TiesToBilan({ trialBalance, tableau2056 })).not.toThrow();
  });

  it('throws when 2056 diverges from the raw trial-balance sum — a classification bug, not a data problem', () => {
    const trialBalance = buildTrialBalance([...ORACLE_BILAN_LIGNES, ...PROVISION_LEDGER_LIGNES]);
    const tableau2056 = computeTableau2056(ALL_PROVISION_MOVEMENT_LIGNES);
    const broken = { ...tableau2056, totalGeneral: '999999.99' };
    expect(() => assertTableau2056TiesToBilan({ trialBalance, tableau2056: broken })).toThrow(
      /does not equal the raw trial-balance sum/,
    );
  });

  it('ignores non-provision accounts in the trial balance (e.g. immobilisations, capital) — only T21 (151100) contributes', () => {
    // No PROVISION_LEDGER_LIGNES added this time — ORACLE_BILAN_LIGNES on its own already contains
    // one real provision (T21, 151100, credit 5000.00); everything else (~120 000+ across
    // immobilisations, capital, clients, etc.) must not leak into the raw sum.
    const trialBalance = buildTrialBalance(ORACLE_BILAN_LIGNES);
    const tableau2056 = computeTableau2056([
      {
        accountNumber: '151100',
        isOpeningBalance: false,
        debit: Money.zero(),
        credit: Money.fromString('5000.00'),
      },
    ]);
    expect(() => assertTableau2056TiesToBilan({ trialBalance, tableau2056 })).not.toThrow();
    expect(tableau2056.totalGeneral).toBe('5000.00');
  });
});

describe('assertTableau2059TiesToCompteResultat', () => {
  it('passes when both sides are 0,00 (no cessions posted, no cession écritures either)', () => {
    const compteResultat = fakeCompteResultat([
      { code: 'F1', label: '', montant: '0.00' },
      { code: 'G2', label: '', montant: '0.00' },
      { code: 'HD', label: '', montant: '0.00' },
      { code: 'G1', label: '', montant: '0.00' },
      { code: 'G3', label: '', montant: '0.00' },
      { code: 'HH', label: '', montant: '0.00' },
    ]);
    const tableau2059 = computeTableau2059A([]);
    expect(() =>
      assertTableau2059TiesToCompteResultat({ compteResultat, tableau2059 }),
    ).not.toThrow();
  });

  it('tolerates missing cession lines (a compte de résultat where none of those accounts were ever used)', () => {
    const compteResultat = fakeCompteResultat([{ code: 'FC', label: '', montant: '1000.00' }]);
    const tableau2059 = computeTableau2059A([]);
    expect(() =>
      assertTableau2059TiesToCompteResultat({ compteResultat, tableau2059 }),
    ).not.toThrow();
  });

  it('throws when a cession écriture was posted (F1/775) with no matching 2059-A entry — an orphaned cession', () => {
    const compteResultat = fakeCompteResultat([
      { code: 'F1', label: '', montant: '5000.00' },
      { code: 'G1', label: '', montant: '0.00' },
    ]);
    const tableau2059 = computeTableau2059A([]); // no cessionDate anywhere → still the empty table
    expect(() => assertTableau2059TiesToCompteResultat({ compteResultat, tableau2059 })).toThrow(
      /does not equal the compte de résultat's net cession result/,
    );
  });
});

describe('assertTableau2057TiesToBilan', () => {
  it('passes for the oracle bilan — 2057 is a pure regrouping of it, so this always holds by construction', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const tableau2057 = computeTableau2057(bilan);
    expect(() => assertTableau2057TiesToBilan({ bilan, tableau2057 })).not.toThrow();
  });

  it('throws when Cadre A has drifted from the bilan lines it should reproduce', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const tableau2057 = computeTableau2057(bilan);
    const broken = { ...tableau2057, totalCreances: '999999.99' };
    expect(() => assertTableau2057TiesToBilan({ bilan, tableau2057: broken })).toThrow(
      /Cadre A total .* does not equal the sum of the bilan lines/,
    );
  });

  it('throws when Cadre B has drifted from the bilan lines it should reproduce', () => {
    const bilan = computeBilan2050(
      buildTrialBalance(ORACLE_BILAN_LIGNES),
      Money.fromString(ORACLE_HN),
    );
    const tableau2057 = computeTableau2057(bilan);
    const broken = { ...tableau2057, totalDettes: '999999.99' };
    expect(() => assertTableau2057TiesToBilan({ bilan, tableau2057: broken })).toThrow(
      /Cadre B total .* does not equal the sum of the bilan lines/,
    );
  });
});
