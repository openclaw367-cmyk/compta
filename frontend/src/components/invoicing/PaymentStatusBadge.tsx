import type { Invoice } from '../../api/types';

const PAYMENT_STATUS_CONFIG: Record<
  NonNullable<Invoice['paymentStatus']>,
  { label: string; className: string }
> = {
  PAID: { label: 'Payée', className: 'bg-positive-soft text-positive' },
  OPEN: { label: 'En attente', className: 'bg-bg text-ink-muted' },
  OVERDUE: { label: 'En retard', className: 'bg-negative-soft text-negative' },
};

/**
 * Shared between InvoicesList.tsx and InvoiceDetailView.tsx — see
 * CLAUDE.md "Invoicing — payment status". `null` for a DRAFT or a
 * CREDIT_NOTE (rendered as a plain dash, never hidden outright, so the
 * column/row reads as "not applicable" rather than looking broken).
 */
export function PaymentStatusBadge({ status }: { status: Invoice['paymentStatus'] }) {
  if (!status) return <span className="text-ink-faint">—</span>;
  const { label, className } = PAYMENT_STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}
