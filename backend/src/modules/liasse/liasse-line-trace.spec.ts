import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { ACTIF_RULES, PASSIF_RULES, DUAL_NATURE_RULES } from './bilan-2050';
import { CDR_RULES } from './compte-resultat-2052-2053';
import { assertLineTraceabilitySums, traceLine } from './liasse-line-trace';
import { buildTrialBalance } from './trial-balance-engine';
import { ORACLE_BILAN_LIGNES, ORACLE_CDR_LIGNES } from './liasse-oracle-fixture';

/**
 * Hand-traced against the SAME oracle dataset bilan-2050.spec.ts and
 * compte-resultat-2052-2053.spec.ts already assert against (see
 * liasse-oracle-fixture.ts's own doc comment) — every expected value
 * below is copied verbatim from those already-verified oracle comments,
 * not re-derived, so a mismatch here would mean this module disagrees
 * with the already-proven forward computation, not that the two
 * oracles independently drifted. See CLAUDE.md "Traceability
 * drill-down" for the design this implements.
 */
describe('traceLine', () => {
  const bilanAccounts = buildTrialBalance(ORACLE_BILAN_LIGNES);
  const cdrAccounts = buildTrialBalance(ORACLE_CDR_LIGNES);
  const bilanRules = [...ACTIF_RULES, ...PASSIF_RULES];

  it('traces a clean, single-account actif line (AN, terrain — 211000)', () => {
    const result = traceLine('AN', bilanAccounts, bilanRules, DUAL_NATURE_RULES);
    expect(result.lineValue).toBe('30000.00');
    expect(result.accounts).toEqual([{ accountNumber: '211000', contribution: '30000.00' }]);
  });

  it('traces a clean, single-account passif line via a credit-normal rule (BX-equivalent shape — DZ, 404000)', () => {
    const result = traceLine('DZ', bilanAccounts, bilanRules, DUAL_NATURE_RULES);
    expect(result.lineValue).toBe('40000.00');
    expect(result.accounts).toEqual([{ accountNumber: '404000', contribution: '40000.00' }]);
  });

  it('traces a clean CDR line (FC, ventes de marchandises — 707000)', () => {
    const result = traceLine('FC', cdrAccounts, CDR_RULES);
    expect(result.lineValue).toBe('30000.00');
    expect(result.accounts).toEqual([{ accountNumber: '707000', contribution: '30000.00' }]);
  });

  it('traces a MULTI-ACCOUNT actif line (BX, clients — 411000 only here, but proves the multi-ligne-same-account net still ties)', () => {
    const result = traceLine('BX', bilanAccounts, bilanRules, DUAL_NATURE_RULES);
    expect(result.lineValue).toBe('15000.00');
    expect(result.accounts).toEqual([{ accountNumber: '411000', contribution: '15000.00' }]);
  });

  describe('dual-nature lines — the confirmed landmine, tested hardest', () => {
    it('CF (débit branch): 512000 nets to a positive (debit) balance, routes to debitLine, contributes as-is', () => {
      const result = traceLine('CF', bilanAccounts, bilanRules, DUAL_NATURE_RULES);
      expect(result.lineValue).toBe('33900.00');
      expect(result.accounts).toEqual([{ accountNumber: '512000', contribution: '33900.00' }]);
    });

    it('DU (crédit branch, TWO contributing accounts, ONE of them dual-nature): 164000 (ordinary PASSIF_RULES match) + 514000 (dual-nature creditLine, overdraft) both land on DU and sum to exactly the report line', () => {
      const result = traceLine('DU', bilanAccounts, bilanRules, DUAL_NATURE_RULES);
      expect(result.lineValue).toBe('43000.00');
      expect(result.accounts).toEqual(
        expect.arrayContaining([
          { accountNumber: '164000', contribution: '40000.00' },
          { accountNumber: '514000', contribution: '3000.00' },
        ]),
      );
      expect(result.accounts).toHaveLength(2);
      // The oracle itself, not just the two individual contributions:
      const summed = result.accounts.reduce(
        (sum, a) => sum.plus(Money.fromString(a.contribution)),
        Money.zero(),
      );
      expect(summed.toApiString()).toBe('43000.00');
    });

    it('a dual-nature line whose drill-down sums correctly is the proof this case is handled — a live sign-flip scenario, not just the fixture', () => {
      // Same account, opposite sign, from bilan-2050.spec.ts's own
      // dedicated sign-reclassification test — proves the reverse
      // mapping follows the account's OWN aggregate sign, not a fixed
      // assumption about which line a prefix "usually" belongs to.
      const overdraft = buildTrialBalance([
        {
          compteNumber: '512000',
          pcgClass: 5,
          debit: Money.zero().toDecimal(),
          credit: Money.fromString('500.00').toDecimal(),
        },
      ]);
      const duResult = traceLine('DU', overdraft, bilanRules, DUAL_NATURE_RULES);
      expect(duResult.lineValue).toBe('500.00');
      expect(duResult.accounts).toEqual([{ accountNumber: '512000', contribution: '500.00' }]);

      const inCredit = buildTrialBalance([
        {
          compteNumber: '512000',
          pcgClass: 5,
          debit: Money.fromString('500.00').toDecimal(),
          credit: Money.zero().toDecimal(),
        },
      ]);
      const cfResult = traceLine('CF', inCredit, bilanRules, DUAL_NATURE_RULES);
      expect(cfResult.lineValue).toBe('500.00');
      expect(cfResult.accounts).toEqual([{ accountNumber: '512000', contribution: '500.00' }]);
    });
  });

  describe('non-drillable lines are refused explicitly, never faked', () => {
    it("throws on DI (bilan) — constructed from the CDR's own HN, never a classifyAccounts() code", () => {
      expect(() => traceLine('DI', bilanAccounts, bilanRules, DUAL_NATURE_RULES)).toThrow(
        BadRequestException,
      );
    });

    it('throws on HM (CDR) — a derived subtotal (GF+GU+HH+HK), never itself a CDR_RULES code', () => {
      expect(() => traceLine('HM', cdrAccounts, CDR_RULES)).toThrow(BadRequestException);
    });

    it('throws on an unknown/typo\'d code the same way — no distinction between "derived" and "doesn\'t exist"', () => {
      expect(() => traceLine('ZZ', bilanAccounts, bilanRules, DUAL_NATURE_RULES)).toThrow(
        BadRequestException,
      );
    });
  });
});

describe('assertLineTraceabilitySums', () => {
  it('passes silently when the detail sums exactly to the official value', () => {
    expect(() =>
      assertLineTraceabilitySums('X1', 'Test line', Money.fromString('100.00'), [
        Money.fromString('60.00'),
        Money.fromString('40.00'),
      ]),
    ).not.toThrow();
  });

  it('throws, naming both figures, when the detail does NOT sum to the official value — proving this oracle actually catches a broken reverse mapping, not just a happy path', () => {
    expect(() =>
      assertLineTraceabilitySums('X1', 'Test line', Money.fromString('100.00'), [
        Money.fromString('60.00'),
        Money.fromString('39.99'),
      ]),
    ).toThrow(ConflictException);
    try {
      assertLineTraceabilitySums('X1', 'Test line', Money.fromString('100.00'), [
        Money.fromString('60.00'),
        Money.fromString('39.99'),
      ]);
    } catch (err) {
      expect((err as Error).message).toContain('99.99');
      expect((err as Error).message).toContain('100.00');
    }
  });

  it('a genuinely empty contributing-accounts list ties only when the official value is itself zero', () => {
    expect(() => assertLineTraceabilitySums('X1', 'Test line', Money.zero(), [])).not.toThrow();
    expect(() =>
      assertLineTraceabilitySums('X1', 'Test line', Money.fromString('10.00'), []),
    ).toThrow(ConflictException);
  });
});
