import { Money } from '../../common/decimal';
import {
  computePaymentAnomalies,
  type OpenInvoiceInput,
  type UnmatchedStatementLineInput,
} from './invoice-anomaly-engine';

const TODAY = new Date('2026-09-05');

function invoice(overrides: Partial<OpenInvoiceInput> = {}): OpenInvoiceInput {
  return {
    invoiceId: 'invoice-1',
    invoiceNumber: '12',
    clientName: 'Client Petit',
    totalTTC: Money.fromString('1200.00'),
    invoiceDate: new Date('2026-07-01'), // 66 days before TODAY
    ...overrides,
  };
}

function statementLine(
  overrides: Partial<UnmatchedStatementLineInput> = {},
): UnmatchedStatementLineInput {
  return {
    id: 'line-1',
    amount: Money.fromString('1200.00'),
    bookingDate: new Date('2026-07-10'),
    bankAccountLabel: 'Compte courant BNP',
    ...overrides,
  };
}

describe('computePaymentAnomalies', () => {
  it('flags an overdue invoice with no bank movement as NONE', () => {
    const result = computePaymentAnomalies([invoice()], [], TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      invoiceId: 'invoice-1',
      matchTier: 'NONE',
      daysOverdue: 66,
      candidates: [],
    });
  });

  it('does not flag an invoice younger than the overdue grace period', () => {
    const result = computePaymentAnomalies(
      [invoice({ invoiceDate: new Date('2026-08-20') })], // 16 days before TODAY
      [],
      TODAY,
    );
    expect(result).toEqual([]);
  });

  it('flags exactly at the overdue boundary (>=, not >)', () => {
    const result = computePaymentAnomalies(
      [invoice({ invoiceDate: new Date('2026-08-06') })], // exactly 30 days before TODAY
      [],
      TODAY,
    );
    expect(result).toHaveLength(1);
    expect(result[0].daysOverdue).toBe(30);
  });

  it('tags a single amount-and-date-eligible bank movement as HIGH', () => {
    const result = computePaymentAnomalies([invoice()], [statementLine()], TODAY);
    expect(result[0].matchTier).toBe('HIGH');
    expect(result[0].candidates).toEqual([
      {
        statementLineId: 'line-1',
        amount: '1200.00',
        bookingDate: '2026-07-10',
        bankAccountLabel: 'Compte courant BNP',
        dateDistanceDays: 9,
      },
    ]);
  });

  it('tags 2+ eligible candidates as AMBIGUOUS, ranked closest-date-first', () => {
    const far = statementLine({ id: 'line-far', bookingDate: new Date('2026-08-20') });
    const near = statementLine({ id: 'line-near', bookingDate: new Date('2026-07-05') });
    const result = computePaymentAnomalies([invoice()], [far, near], TODAY);
    expect(result[0].matchTier).toBe('AMBIGUOUS');
    expect(result[0].candidates.map((c) => c.statementLineId)).toEqual(['line-near', 'line-far']);
  });

  it('never matches a movement with a different amount', () => {
    const result = computePaymentAnomalies(
      [invoice()],
      [statementLine({ amount: Money.fromString('999.00') })],
      TODAY,
    );
    expect(result[0].matchTier).toBe('NONE');
  });

  it('never matches a movement outside the date window', () => {
    const result = computePaymentAnomalies(
      [invoice()],
      [statementLine({ bookingDate: new Date('2026-10-15') })], // 106 days after invoiceDate
      TODAY,
    );
    expect(result[0].matchTier).toBe('NONE');
  });

  it('sorts HIGH-tier anomalies before others, then by days overdue descending', () => {
    const oldNoMatch = invoice({ invoiceId: 'old-no-match', invoiceDate: new Date('2026-01-01') });
    const recentHigh = invoice({ invoiceId: 'recent-high', invoiceDate: new Date('2026-07-01') });
    const result = computePaymentAnomalies(
      [oldNoMatch, recentHigh],
      [statementLine()], // only matches recentHigh's amount/date
      TODAY,
    );
    expect(result.map((r) => r.invoiceId)).toEqual(['recent-high', 'old-no-match']);
  });
});
