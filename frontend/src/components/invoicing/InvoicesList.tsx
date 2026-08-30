import type { Account, Invoice } from '../../api/types';

function clientLabel(invoice: Invoice, accounts: Account[]): string {
  if (invoice.clientNameSnapshot) return invoice.clientNameSnapshot;
  const account = accounts.find((a) => a.id === invoice.clientAccountId);
  return account ? account.label : invoice.clientAccountId;
}

function StatusBadge({ status }: { status: Invoice['status'] }) {
  const isDraft = status === 'DRAFT';
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        isDraft ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive',
      ].join(' ')}
    >
      {isDraft ? 'Brouillon' : 'Finalisée'}
    </span>
  );
}

function TypeBadge({ type }: { type: Invoice['type'] }) {
  const isCreditNote = type === 'CREDIT_NOTE';
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        isCreditNote ? 'bg-accent-soft text-accent' : 'bg-bg text-ink-muted',
      ].join(' ')}
    >
      {isCreditNote ? 'Avoir' : 'Facture'}
    </span>
  );
}

export function InvoicesList({
  invoices,
  accounts,
  selectedId,
  onSelect,
  onDelete,
}: {
  invoices: Invoice[];
  accounts: Account[];
  selectedId: string | null;
  onSelect: (invoice: Invoice) => void;
  onDelete: (invoice: Invoice) => void;
}) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
        Aucune facture pour cet exercice.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-bg text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5">N°</th>
            <th className="px-4 py-2.5">Type</th>
            <th className="px-4 py-2.5">Statut</th>
            <th className="px-4 py-2.5">Client</th>
            <th className="px-4 py-2.5">Date</th>
            <th className="px-4 py-2.5">Lignes</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const isSelected = invoice.id === selectedId;
            return (
              <tr
                key={invoice.id}
                onClick={() => onSelect(invoice)}
                className={[
                  'cursor-pointer border-b border-border/60 transition-colors last:border-b-0',
                  isSelected ? 'bg-accent-soft' : 'hover:bg-bg',
                ].join(' ')}
              >
                <td className="px-4 py-2.5 font-medium tabular-nums text-ink">
                  {invoice.invoiceNumber ?? '—'}
                </td>
                <td className="px-4 py-2.5">
                  <TypeBadge type={invoice.type} />
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={invoice.status} />
                </td>
                <td className="px-4 py-2.5 text-ink">{clientLabel(invoice, accounts)}</td>
                <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                  {invoice.invoiceDate?.slice(0, 10) ?? '—'}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-ink-muted">{invoice.lines.length}</td>
                <td className="px-4 py-2.5 text-right">
                  {invoice.status === 'DRAFT' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(invoice);
                      }}
                      className="rounded p-1 text-ink-faint transition-colors hover:bg-negative-soft hover:text-negative"
                      aria-label="Supprimer le brouillon"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
