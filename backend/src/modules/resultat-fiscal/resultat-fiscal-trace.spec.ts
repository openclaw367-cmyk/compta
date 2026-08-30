import { Money } from '../../common/decimal';
import { TrialBalanceAccount } from '../liasse/trial-balance-engine';
import { assertConfirmableLineTraceSums, traceConfirmableLine } from './resultat-fiscal-trace';

const FISCAL_YEAR_ID = 'fy-2026';

const CHARGES_ACCOUNTS: TrialBalanceAccount[] = [
  { accountNumber: '6712', pcgClass: 6, balance: Money.fromString('150.00') },
  { accountNumber: '6788', pcgClass: 6, balance: Money.fromString('500.00') },
  { accountNumber: '63514', pcgClass: 6, balance: Money.fromString('320.00') },
  { accountNumber: '635800', pcgClass: 6, balance: Money.fromString('75.00') },
];

describe('traceConfirmableLine', () => {
  it('traces WJ to account 6712 only, never the unrelated 6788', () => {
    const result = traceConfirmableLine(CHARGES_ACCOUNTS, FISCAL_YEAR_ID, 'WJ');
    expect(result.columnValue).toBe('150.00');
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountNumber: '6712', contribution: '150.00' }),
    ]);
  });

  it('traces WG to account 63514 only, never the unrelated 635800', () => {
    const result = traceConfirmableLine(CHARGES_ACCOUNTS, FISCAL_YEAR_ID, 'WG');
    expect(result.columnValue).toBe('320.00');
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountNumber: '63514', contribution: '320.00' }),
    ]);
  });

  it('sums multiple matching accounts under the same prefix', () => {
    const accounts: TrialBalanceAccount[] = [
      ...CHARGES_ACCOUNTS,
      { accountNumber: '671200', pcgClass: 6, balance: Money.fromString('25.00') },
    ];
    const result = traceConfirmableLine(accounts, FISCAL_YEAR_ID, 'WJ');
    expect(result.columnValue).toBe('175.00');
    expect(result.accounts).toHaveLength(2);
  });

  it('ties to 0,00 with an empty account list, not an error', () => {
    const result = traceConfirmableLine([], FISCAL_YEAR_ID, 'WJ');
    expect(result.columnValue).toBe('0.00');
    expect(result.accounts).toEqual([]);
  });

  it('refuses an unknown code rather than faking a decomposition', () => {
    expect(() => traceConfirmableLine(CHARGES_ACCOUNTS, FISCAL_YEAR_ID, 'WD')).toThrow(
      /n'est pas traçable/,
    );
  });
});

describe('assertConfirmableLineTraceSums', () => {
  it('passes when the détail sum matches the independent suggestion', () => {
    const trace = traceConfirmableLine(CHARGES_ACCOUNTS, FISCAL_YEAR_ID, 'WJ');
    expect(() => assertConfirmableLineTraceSums(trace, Money.fromString('150.00'))).not.toThrow();
  });

  it('throws, naming both figures, when the détail sum does not match', () => {
    const trace = traceConfirmableLine(CHARGES_ACCOUNTS, FISCAL_YEAR_ID, 'WJ');
    expect(() => assertConfirmableLineTraceSums(trace, Money.fromString('999.00'))).toThrow(
      /150\.00.*999\.00/s,
    );
  });
});
