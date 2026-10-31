import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { LiasseLigne, buildTrialBalance } from '../liasse/trial-balance-engine';
import { ORACLE_CDR_LIGNES, ORACLE_HN } from '../liasse/liasse-oracle-fixture';
import {
  traceCashFlowCaf,
  traceCashFlowDeltaLine,
  traceCashFlowOpeningBilanLine,
} from './cash-flow-trace';

/**
 * Tier 4 oracle tests — see CLAUDE.md "Traceability drill-down (Tier
 * 4)" and this module's own doc comment. Each trace function
 * independently re-derives its own total from raw accounts (via Tier
 * 1's `traceLine()`) and is asserted against a hand-computed value —
 * never the same call checked against itself.
 */

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function ligne(compteNumber: string, pcgClass: number, debit: string, credit: string): LiasseLigne {
  return { compteNumber, pcgClass, debit: d(debit), credit: d(credit) };
}

describe('traceCashFlowCaf', () => {
  // Reuses the SAME oracle dataset the 2050-series/Tier-1 specs already
  // verify against — ORACLE_HN is this dataset's own hand-computed
  // résultat net. CAF hand computation, from the raw ledger lines:
  // - dotations (GA 681100=8000.00 + GD 681500=5000.00) = 13000.00
  // - valeurComptableElementsCedes (HH, 671000=300.00; G1/G3 untouched) = 300.00
  // - reprises (FP/GM untouched) = 0.00
  // - produitsDesCessions (HD, 771000=500.00; F1/G2 untouched) = 500.00
  // CAF = -36100.00 + 13000.00 + 300.00 - 0.00 - 500.00 = -23300.00
  const cdrAccounts = buildTrialBalance(ORACLE_CDR_LIGNES);
  const resultatNet = Money.fromString(ORACLE_HN);
  const officialCaf = Money.fromString('-23300.00');

  it('decomposes the CAF into its documented terms, matching the hand-computed total', () => {
    const result = traceCashFlowCaf(cdrAccounts, resultatNet, officialCaf);
    expect(result.officialValue).toBe('-23300.00');

    const resultatNetTerm = result.terms.find((t) => t.key === 'resultatNet')!;
    expect(resultatNetTerm.value).toBe('-36100.00');
    expect(resultatNetTerm.codes).toBeUndefined();
    expect(resultatNetTerm.nonTraceableReason).toBeDefined();

    const dotations = result.terms.find((t) => t.key === 'dotationsAmortissementsProvisions')!;
    expect(dotations.value).toBe('13000.00');
    expect(dotations.codes).toEqual(
      expect.arrayContaining([
        { code: 'GA', label: expect.any(String), sign: 1, value: '8000.00' },
        { code: 'GD', label: expect.any(String), sign: 1, value: '5000.00' },
      ]),
    );

    const valeurComptable = result.terms.find((t) => t.key === 'valeurComptableElementsCedes')!;
    expect(valeurComptable.value).toBe('300.00');

    const produitsCessions = result.terms.find((t) => t.key === 'produitsDesCessions')!;
    expect(produitsCessions.value).toBe('500.00');

    const reprises = result.terms.find((t) => t.key === 'reprisesAmortissementsProvisions')!;
    expect(reprises.value).toBe('0.00');

    // Re-sum every term with its own sign — the SAME formula this function computed internally,
    // re-derived here a THIRD time, independent of both the production code and the fixture's own
    // comment — must land on the official CAF.
    const recomputed = result.terms.reduce(
      (sum, term) => sum.plus(Money.fromString(term.value).times(term.sign)),
      Money.zero(),
    );
    expect(recomputed.toApiString()).toBe('-23300.00');
  });

  it('throws ConflictException when the already-computed CAF disagrees with the re-derived total', () => {
    expect(() => traceCashFlowCaf(cdrAccounts, resultatNet, Money.fromString('0.00'))).toThrow(
      ConflictException,
    );
  });
});

describe('traceCashFlowDeltaLine', () => {
  const OPENING_LIGNES: LiasseLigne[] = [
    ligne('411000', 4, '5000.00', '0.00'), // BX
    ligne('370000', 3, '1000.00', '0.00'), // BT (stock)
    ligne('401000', 4, '0.00', '2000.00'), // DX
    ligne('404000', 4, '0.00', '1000.00'), // DZ
    ligne('164000', 1, '0.00', '10000.00'), // DU (emprunt)
    ligne('101000', 1, '0.00', '50000.00'), // DA (capital)
  ];
  const CLOSING_LIGNES: LiasseLigne[] = [
    ligne('411000', 4, '12000.00', '0.00'), // BX: 5000 -> 12000, delta +7000
    ligne('370000', 3, '3000.00', '0.00'), // BT: 1000 -> 3000
    ligne('310000', 3, '2000.00', '0.00'), // BL: 0 -> 2000 ; stocks delta = 5000 - 1000 = 4000
    ligne('401000', 4, '0.00', '1500.00'), // DX: 2000 -> 1500
    ligne('444000', 4, '0.00', '800.00'), // DY: 0 -> 800 ; DX+DY delta = 2300 - 2000 = 300
    ligne('404000', 4, '0.00', '4000.00'), // DZ: 1000 -> 4000, delta +3000
    ligne('164000', 1, '0.00', '15000.00'), // DU: 10000 -> 15000, delta +5000
    ligne('101000', 1, '0.00', '50000.00'), // DA: unchanged, delta 0
  ];
  const openingAccounts = buildTrialBalance(OPENING_LIGNES);
  const closingAccounts = buildTrialBalance(CLOSING_LIGNES);

  it('traces variationCreancesClients (BX, single account)', () => {
    const result = traceCashFlowDeltaLine(
      'variationCreancesClients',
      openingAccounts,
      closingAccounts,
      Money.fromString('7000.00'),
    );
    expect(result.opening.totalValue).toBe('5000.00');
    expect(result.closing.totalValue).toBe('12000.00');
    expect(result.officialValue).toBe('7000.00');
    expect(result.opening.codes).toEqual([
      { code: 'BX', label: expect.any(String), value: '5000.00' },
    ]);
  });

  it('traces variationStocks (5 codes, only 2 populated)', () => {
    const result = traceCashFlowDeltaLine(
      'variationStocks',
      openingAccounts,
      closingAccounts,
      Money.fromString('4000.00'),
    );
    expect(result.opening.totalValue).toBe('1000.00');
    expect(result.closing.totalValue).toBe('5000.00');
    expect(result.opening.codes.map((c) => c.code)).toEqual(['BL', 'BN', 'BP', 'BR', 'BT']);
  });

  it('traces variationDettesExploitation (DX+DY, two codes)', () => {
    const result = traceCashFlowDeltaLine(
      'variationDettesExploitation',
      openingAccounts,
      closingAccounts,
      Money.fromString('300.00'),
    );
    expect(result.opening.totalValue).toBe('2000.00');
    expect(result.closing.totalValue).toBe('2300.00');
  });

  it('traces variationDettesSurImmobilisations (DZ)', () => {
    const result = traceCashFlowDeltaLine(
      'variationDettesSurImmobilisations',
      openingAccounts,
      closingAccounts,
      Money.fromString('3000.00'),
    );
    expect(result.closing.totalValue).toBe('4000.00');
  });

  it('traces variationEmprunts (DS+DT+DU+DV)', () => {
    const result = traceCashFlowDeltaLine(
      'variationEmprunts',
      openingAccounts,
      closingAccounts,
      Money.fromString('5000.00'),
    );
    expect(result.opening.totalValue).toBe('10000.00');
    expect(result.closing.totalValue).toBe('15000.00');
  });

  it('traces variationCapital (DA) — a legitimate zero delta', () => {
    const result = traceCashFlowDeltaLine(
      'variationCapital',
      openingAccounts,
      closingAccounts,
      Money.fromString('0.00'),
    );
    expect(result.officialValue).toBe('0.00');
  });

  it('throws BadRequestException for an unknown key', () => {
    expect(() =>
      traceCashFlowDeltaLine('notARealKey', openingAccounts, closingAccounts, Money.zero()),
    ).toThrow(BadRequestException);
  });

  it('throws ConflictException when the official value disagrees with the re-derived delta', () => {
    expect(() =>
      traceCashFlowDeltaLine(
        'variationCreancesClients',
        openingAccounts,
        closingAccounts,
        Money.fromString('1.00'),
      ),
    ).toThrow(ConflictException);
  });
});

describe('traceCashFlowOpeningBilanLine', () => {
  const openingAccounts = buildTrialBalance([
    ligne('411000', 4, '5000.00', '0.00'),
    ligne('401000', 4, '0.00', '2000.00'),
  ]);

  it('reuses traceLine() verbatim on the opening-only account subset', () => {
    const result = traceCashFlowOpeningBilanLine('BX', openingAccounts);
    expect(result.lineValue).toBe('5000.00');
    expect(result.accounts).toEqual([{ accountNumber: '411000', contribution: '5000.00' }]);
  });

  it('a line with zero opening contribution returns an empty account list, not an error', () => {
    const result = traceCashFlowOpeningBilanLine('CF', openingAccounts);
    expect(result.lineValue).toBe('0.00');
    expect(result.accounts).toEqual([]);
  });
});
