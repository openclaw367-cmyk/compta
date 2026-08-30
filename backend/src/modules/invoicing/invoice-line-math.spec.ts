import { computeInvoiceLineAmounts } from './invoice-line-math';

describe('computeInvoiceLineAmounts', () => {
  it('computes HT/VAT/TTC for a normal taxed line', () => {
    const result = computeInvoiceLineAmounts('3.00', '500.00', '20.00');
    expect(result.totalHT.toApiString()).toBe('1500.00');
    expect(result.vatAmount.toApiString()).toBe('300.00');
    expect(result.totalTTC.toApiString()).toBe('1800.00');
  });

  it('produces zero VAT for a VAT-exempt line (null rate), never guessed', () => {
    const result = computeInvoiceLineAmounts('1.00', '1000.00', null);
    expect(result.totalHT.toApiString()).toBe('1000.00');
    expect(result.vatAmount.toApiString()).toBe('0.00');
    expect(result.totalTTC.toApiString()).toBe('1000.00');
  });

  it('rounds HT to the centime before computing VAT off the rounded value (stated convention)', () => {
    // 3 x 33.335 = 100.005 -> rounds to 100.01 (toFixed(2) half-up on .005... in binary-safe Decimal)
    const result = computeInvoiceLineAmounts('3.00', '33.335', '20.00');
    expect(result.totalHT.toApiString()).toBe('100.01');
    // VAT computed off the ROUNDED 100.01, not the raw 100.005: 100.01 * 0.20 = 20.002 -> 20.00
    expect(result.vatAmount.toApiString()).toBe('20.00');
  });

  it('handles a fractional rate (5,5 %) correctly', () => {
    const result = computeInvoiceLineAmounts('2.00', '100.00', '5.50');
    expect(result.totalHT.toApiString()).toBe('200.00');
    expect(result.vatAmount.toApiString()).toBe('11.00');
  });
});
