/** Draft state for one invoice line in the editor — see InvoiceLinesEditor.tsx. */
export interface DraftInvoiceLine {
  key: string;
  description: string;
  quantity: string;
  unitPriceHT: string;
  revenueAccountId: string | null;
  vatRateId: string | null;
}

let keySeq = 0;
export function emptyInvoiceLine(): DraftInvoiceLine {
  keySeq += 1;
  return {
    key: `il${keySeq}`,
    description: '',
    quantity: '1',
    unitPriceHT: '',
    revenueAccountId: null,
    vatRateId: null,
  };
}
