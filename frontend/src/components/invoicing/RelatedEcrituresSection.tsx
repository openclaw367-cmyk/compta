import { useNavigate } from 'react-router-dom';
import { useRelatedEcritures } from '../../api/queries';
import type { InvoiceRelatedEcriture, InvoiceRelatedEcritureKind } from '../../api/types';

const KIND_LABEL: Record<InvoiceRelatedEcritureKind, string> = {
  POSTED: 'Écriture comptable',
  ENCAISSEMENT: 'TVA sur encaissements',
  PAYMENT: 'Règlement',
  CORRECTS: 'Facture rectifiée',
  CORRECTED_BY: 'Avoir',
};

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * All écritures tied to this invoice, together — see CLAUDE.md
 * "Invoicing — related écritures" / roadmap item 1e. Each row is a
 * real deep link (`/ecritures?journal=&ecriture=`), the SAME idiom
 * DashboardPage.tsx's own recent-entries widget and the command
 * palette's écriture search already use — not a new écriture viewer.
 */
export function RelatedEcrituresSection({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading, isError } = useRelatedEcritures(invoiceId);
  const navigate = useNavigate();

  if (isLoading) {
    return <div className="h-16 w-full animate-pulse rounded-md bg-border" />;
  }
  if (isError || !data) {
    return (
      <p className="text-[12.5px] text-ink-faint">Impossible de charger les écritures liées.</p>
    );
  }
  if (data.length === 0) {
    return <p className="text-[12.5px] text-ink-faint">Aucune écriture liée pour le moment.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {data.map((entry: InvoiceRelatedEcriture) => (
        <button
          key={entry.ecritureId}
          type="button"
          onClick={() => navigate(`/ecritures?journal=${entry.journalId}&ecriture=${entry.ecritureId}`)}
          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-[12.5px] transition-colors hover:border-accent hover:bg-bg"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-[11px] font-medium text-ink-muted">
              {KIND_LABEL[entry.kind]}
              {entry.relatedInvoiceNumber ? ` n° ${entry.relatedInvoiceNumber}` : ''}
            </span>
            <span className="truncate text-ink">{entry.libelle}</span>
          </div>
          <span className="shrink-0 whitespace-nowrap tabular-nums text-ink-faint">
            {entry.journalCode} · {entry.ecritureNum ?? '—'} · {formatDate(entry.ecritureDate)}
          </span>
        </button>
      ))}
    </div>
  );
}
