import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import { DualNatureRule, LineRule, classifyAccounts } from './liasse-line-rules';
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
