import type { VatRate } from '../api/types';

/** "20,00 % — Taux normal" — shared between the journal grid's VAT-rate select and the invoicing line editor. */
export function formatVatRateOption(rate: VatRate): string {
  return `${rate.ratePercent.replace('.', ',')} % — ${rate.label}`;
}
