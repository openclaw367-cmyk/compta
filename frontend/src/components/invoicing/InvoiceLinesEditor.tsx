import type { Account, VatRate } from '../../api/types';
import { formatVatRateOption } from '../../lib/vatRates';
import { AccountCombobox } from '../journal/AccountCombobox';
import { sanitizeAmountBuffer } from '../../lib/money';
import { emptyInvoiceLine, type DraftInvoiceLine } from '../../lib/invoiceLines';

/**
 * No live total is shown here, deliberately — an Invoice/InvoiceLine
 * carries no computed total of its own; only InvoiceMentions (produced
 * at finalize() time, or re-derived by GET .../mentions afterward) has
 * one, always server-computed. Reimplementing quantity × unitPriceHT ×
 * (1 + rate) here would be exactly the client-side arithmetic
 * reimplementation this app's own reports (e.g. ResultatFiscalPage)
 * deliberately avoid — "the displayed total can never drift from what
 * the backend verified" applies here too, even though invoicing has no
 * dedicated live-preview precedent to point at directly.
 */
export function InvoiceLinesEditor({
  lines,
  revenueAccounts,
  vatRates,
  disabled,
  onChange,
}: {
  lines: DraftInvoiceLine[];
  revenueAccounts: Account[];
  vatRates: VatRate[];
  disabled?: boolean;
  onChange: (lines: DraftInvoiceLine[]) => void;
}) {
  function updateLine(index: number, patch: Partial<DraftInvoiceLine>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }
  function addLine() {
    onChange([...lines, emptyInvoiceLine()]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_90px_120px_1fr_180px_32px] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        <span>Désignation</span>
        <span>Qté</span>
        <span>PU HT</span>
        <span>Compte produit</span>
        <span>Taux TVA</span>
        <span />
      </div>
      {lines.map((line, index) => (
        <div key={line.key} className="grid grid-cols-[1fr_90px_120px_1fr_180px_32px] gap-2">
          <input
            type="text"
            value={line.description}
            disabled={disabled}
            onChange={(e) => updateLine(index, { description: e.target.value })}
            placeholder="Prestation, produit…"
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:bg-bg disabled:text-ink-faint"
          />
          <input
            type="text"
            value={line.quantity}
            disabled={disabled}
            onChange={(e) => updateLine(index, { quantity: sanitizeAmountBuffer(e.target.value) })}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-accent disabled:bg-bg disabled:text-ink-faint"
          />
          <input
            type="text"
            value={line.unitPriceHT}
            disabled={disabled}
            onChange={(e) => updateLine(index, { unitPriceHT: sanitizeAmountBuffer(e.target.value) })}
            placeholder="0,00"
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-accent disabled:bg-bg disabled:text-ink-faint"
          />
          <AccountCombobox
            accounts={revenueAccounts}
            value={line.revenueAccountId}
            onSelect={(id) => updateLine(index, { revenueAccountId: id })}
            placeholder="707000…"
            disabled={disabled}
          />
          <select
            value={line.vatRateId ?? ''}
            disabled={disabled}
            onChange={(e) => updateLine(index, { vatRateId: e.target.value === '' ? null : e.target.value })}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:bg-bg disabled:text-ink-faint"
          >
            <option value="">Exonéré</option>
            {vatRates.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {formatVatRateOption(rate)}
              </option>
            ))}
          </select>
          {!disabled && (
            <button
              type="button"
              onClick={() => removeLine(index)}
              disabled={lines.length <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-negative-soft hover:text-negative disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Supprimer la ligne"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={addLine}
          className="mt-1 self-start rounded-md px-2.5 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft"
        >
          + Ajouter une ligne
        </button>
      )}
    </div>
  );
}
