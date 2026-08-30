import { Money } from '../../common/decimal';

/**
 * Shared primitive — the ONE place quantity × unit-price-HT × VAT-rate
 * math happens for invoicing. Both `invoice-posting.ts` (the écriture
 * shape) and `invoice-mentions.ts` (the mandatory-mentions data) call
 * this, so they can never silently disagree on a single line's own
 * arithmetic — only on how they GROUP lines afterward (by account for
 * posting, by rate for mentions), which is exactly what
 * `assertInvoiceMentionsTieToPosting()` in `invoice-mentions.ts` then
 * verifies independently.
 *
 * Rounding convention, a stated design choice (not derived from an
 * official spec the way the CA3 declaration's own rounding is — this is
 * invoice generation, not a VAT declaration, and this pass's regulatory
 * research found no governing citation for per-line invoice rounding):
 * each line's HT amount is rounded to the centime FIRST, then VAT is
 * computed off the ROUNDED HT and rounded again. This is a common,
 * defensible invoicing convention (round-per-line), but a different one
 * (compute everything at full precision, round only at the invoice
 * total) is also legitimate — flagged here so a future session doesn't
 * mistake this for a settled, sourced rule the way e.g.
 * `roundToNearestEuro()`'s CA3 rounding is.
 */

export interface InvoiceLineAmounts {
  totalHT: Money;
  vatAmount: Money;
  totalTTC: Money;
}

/** vatRatePercent null = VAT-exempt line — vatAmount is exactly zero, never guessed. */
export function computeInvoiceLineAmounts(
  quantity: string,
  unitPriceHT: string,
  vatRatePercent: string | null,
): InvoiceLineAmounts {
  const rawHT = Money.fromString(unitPriceHT).times(quantity);
  const totalHT = Money.fromString(rawHT.toApiString());
  const vatAmount = vatRatePercent
    ? Money.fromString(totalHT.times(vatRatePercent).dividedBy(100).toApiString())
    : Money.zero();
  return { totalHT, vatAmount, totalTTC: totalHT.plus(vatAmount) };
}
