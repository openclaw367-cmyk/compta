import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import {
  DualNatureRule,
  LineRule,
  classifyAccounts,
  resolveLineCode,
  resolveLineContribution,
} from './liasse-line-rules';
import { buildTrialBalance } from './trial-balance-engine';

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

const RULES: LineRule[] = [
  { code: 'X1', label: 'Debit-normal line', prefixes: ['600'], direction: 'debit' },
  { code: 'X2', label: 'Credit-normal line', prefixes: ['700'], direction: 'credit' },
  {
    code: 'X3',
    label: 'Allowed-negative line',
    prefixes: ['800'],
    direction: 'debit',
    allowNegative: true,
  },
];

describe('classifyAccounts', () => {
  it('sums a debit-normal line as debit − credit, and a credit-normal line as credit − debit', () => {
    const accounts = buildTrialBalance([
      { compteNumber: '600100', pcgClass: 6, debit: d('300.00'), credit: d('50.00') },
      { compteNumber: '700100', pcgClass: 7, debit: d('20.00'), credit: d('900.00') },
    ]);
    const totals = classifyAccounts(accounts, RULES);
    expect(totals.get('X1')?.toApiString()).toBe('250.00');
    expect(totals.get('X2')?.toApiString()).toBe('880.00');
  });

  it('nets a contra account assigned to the same line without any special-casing', () => {
    const accounts = buildTrialBalance([
      { compteNumber: '600100', pcgClass: 6, debit: d('1000.00'), credit: d('0.00') },
      { compteNumber: '600900', pcgClass: 6, debit: d('0.00'), credit: d('150.00') },
    ]);
    const rules: LineRule[] = [
      {
        code: 'X1',
        label: 'Achats and their rabais',
        prefixes: ['6001', '6009'],
        direction: 'debit',
      },
    ];
    const totals = classifyAccounts(accounts, rules);
    expect(totals.get('X1')?.toApiString()).toBe('850.00');
  });

  it('throws when an account matches no rule', () => {
    const accounts = buildTrialBalance([
      { compteNumber: '999000', pcgClass: 9, debit: d('10.00'), credit: d('0.00') },
    ]);
    expect(() => classifyAccounts(accounts, RULES)).toThrow(/no liasse line mapping/);
  });

  it('throws when an account matches more than one rule', () => {
    const accounts = buildTrialBalance([
      { compteNumber: '600100', pcgClass: 6, debit: d('10.00'), credit: d('0.00') },
    ]);
    const overlapping: LineRule[] = [
      { code: 'X1', label: 'first', prefixes: ['600'], direction: 'debit' },
      { code: 'X4', label: 'second, overlapping', prefixes: ['6001'], direction: 'debit' },
    ];
    expect(() => classifyAccounts(accounts, overlapping)).toThrow(
      /matches more than one liasse line/,
    );
  });

  it('throws when a line not marked allowNegative nets negative', () => {
    const accounts = buildTrialBalance([
      { compteNumber: '600100', pcgClass: 6, debit: d('0.00'), credit: d('50.00') },
    ]);
    expect(() => classifyAccounts(accounts, RULES)).toThrow(/negative/);
  });

  it('permits a negative result on a line marked allowNegative', () => {
    const accounts = buildTrialBalance([
      { compteNumber: '800100', pcgClass: 8, debit: d('0.00'), credit: d('50.00') },
    ]);
    const totals = classifyAccounts(accounts, RULES);
    expect(totals.get('X3')?.toApiString()).toBe('-50.00');
  });

  it('routes a dual-nature account by its own balance sign, bypassing normal rule matching entirely', () => {
    const dualNature: DualNatureRule[] = [{ prefixes: ['512'], debitLine: 'X1', creditLine: 'X2' }];
    const debitAccounts = buildTrialBalance([
      { compteNumber: '512000', pcgClass: 5, debit: d('500.00'), credit: d('0.00') },
    ]);
    expect(classifyAccounts(debitAccounts, RULES, dualNature).get('X1')?.toApiString()).toBe(
      '500.00',
    );

    const creditAccounts = buildTrialBalance([
      { compteNumber: '512000', pcgClass: 5, debit: d('0.00'), credit: d('500.00') },
    ]);
    expect(classifyAccounts(creditAccounts, RULES, dualNature).get('X2')?.toApiString()).toBe(
      '500.00',
    );
  });

  it('reports every rule, including those with zero activity, at zero rather than omitting them', () => {
    const totals = classifyAccounts([], RULES);
    expect(totals.get('X1')?.toApiString()).toBe(Money.zero().toApiString());
    expect(totals.get('X2')?.toApiString()).toBe(Money.zero().toApiString());
  });
});

/**
 * These two are the reverse-mapping primitives the traceability
 * drill-down (`liasse-line-trace.ts`) is built on — see CLAUDE.md
 * "Traceability drill-down". Every case here has a matching case above
 * in `classifyAccounts`'s own suite, using the SAME rule tables, so a
 * mismatch between the two functions' account-to-code decisions would
 * show up as two tests disagreeing, not just one function's own tests
 * passing in isolation.
 */
describe('resolveLineContribution / resolveLineCode', () => {
  it('resolves a debit-normal account to its code and a positive contribution equal to its balance', () => {
    const result = resolveLineContribution('600100', Money.fromString('250.00'), RULES);
    expect(result).toEqual({ code: 'X1', contribution: Money.fromString('250.00') });
    expect(resolveLineCode('600100', Money.fromString('250.00'), RULES)).toBe('X1');
  });

  it('resolves a credit-normal account: contribution is the NEGATED balance (a net-credit balance is negative)', () => {
    const result = resolveLineContribution('700100', Money.fromString('-880.00'), RULES);
    expect(result).toEqual({ code: 'X2', contribution: Money.fromString('880.00') });
  });

  it('a dual-nature account with a positive (net debit) balance routes to debitLine, contributing its balance as-is', () => {
    const dualNature: DualNatureRule[] = [{ prefixes: ['512'], debitLine: 'X1', creditLine: 'X2' }];
    const result = resolveLineContribution('512000', Money.fromString('500.00'), RULES, dualNature);
    expect(result).toEqual({ code: 'X1', contribution: Money.fromString('500.00') });
  });

  it('a dual-nature account with a negative (net credit) balance routes to creditLine, contributing the NEGATED balance — the exact landmine tableau-2057 hit once', () => {
    const dualNature: DualNatureRule[] = [{ prefixes: ['512'], debitLine: 'X1', creditLine: 'X2' }];
    const result = resolveLineContribution(
      '512000',
      Money.fromString('-500.00'),
      RULES,
      dualNature,
    );
    expect(result).toEqual({ code: 'X2', contribution: Money.fromString('500.00') });
  });

  it('dual-nature bypasses ordinary rule matching entirely, even when a rule would also match the prefix', () => {
    const dualNature: DualNatureRule[] = [{ prefixes: ['600'], debitLine: 'X3', creditLine: 'X2' }];
    // 600100 would ordinarily match RULES' own X1 — dual-nature must win.
    const result = resolveLineContribution('600100', Money.fromString('10.00'), RULES, dualNature);
    expect(result.code).toBe('X3');
  });

  it('throws (never guesses) when an account matches no rule and no dual-nature rule', () => {
    expect(() => resolveLineContribution('999000', Money.fromString('10.00'), RULES)).toThrow(
      /no liasse line mapping/,
    );
  });

  it('throws when an account matches more than one rule', () => {
    const overlapping: LineRule[] = [
      { code: 'X1', label: 'first', prefixes: ['600'], direction: 'debit' },
      { code: 'X4', label: 'second, overlapping', prefixes: ['6001'], direction: 'debit' },
    ];
    expect(() => resolveLineContribution('600100', Money.fromString('10.00'), overlapping)).toThrow(
      /matches more than one liasse line/,
    );
  });

  it("summing resolveLineContribution() over every account reproduces classifyAccounts()'s own total for that code, including the dual-nature case", () => {
    const dualNature: DualNatureRule[] = [{ prefixes: ['512'], debitLine: 'X1', creditLine: 'X2' }];
    const accounts = buildTrialBalance([
      { compteNumber: '600100', pcgClass: 6, debit: d('300.00'), credit: d('50.00') },
      { compteNumber: '512000', pcgClass: 5, debit: d('0.00'), credit: d('120.00') }, // net credit -> dual-nature creditLine X2
    ]);
    const forwardTotals = classifyAccounts(accounts, RULES, dualNature);

    const reverseTotal = accounts
      .map((a) => resolveLineContribution(a.accountNumber, a.balance, RULES, dualNature))
      .filter((r) => r.code === 'X2')
      .reduce((sum, r) => sum.plus(r.contribution), Money.zero());

    expect(reverseTotal.toApiString()).toBe(forwardTotals.get('X2')?.toApiString());
    expect(reverseTotal.toApiString()).toBe('120.00');
  });
});
