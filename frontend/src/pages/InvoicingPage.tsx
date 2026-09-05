import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Invoice } from '../api/types';
import { useAccounts, useDeleteInvoice, useInvoices, useVatRates } from '../api/queries';
import { ApiError } from '../api/client';
import { useAppContext } from '../context/appContextStore';
import { InvoiceEditor } from '../components/invoicing/InvoiceEditor';
import { InvoiceDetailView } from '../components/invoicing/InvoiceDetailView';
import { InvoicesList } from '../components/invoicing/InvoicesList';

type EditorState =
  | { mode: 'closed' }
  | { mode: 'new' }
  | { mode: 'edit'; invoice: Invoice }
  | { mode: 'credit-note'; invoice: Invoice };

const NO_INVOICES: never[] = [];
const NO_ACCOUNTS: never[] = [];
const NO_VAT_RATES: never[] = [];

/**
 * Invoicing — Phase A frontend. See CLAUDE.md "Invoicing — Phase A" and
 * "Invoicing — Factur-X rendering" — backend-only until this pass. A
 * DRAFT invoice opens the editable `InvoiceEditor`; a FINALIZED one
 * opens the read-only `InvoiceDetailView` (mentions + Factur-X
 * download), never the editor, mirroring écriture immutability.
 */
export function InvoicingPage() {
  const { fiscalYearId, fiscalYearsLoading, currentCompany } = useAppContext();
  const invoicesQuery = useInvoices();
  const accountsQuery = useAccounts();
  const vatRatesQuery = useVatRates();
  const deleteInvoice = useDeleteInvoice();

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const deepLinkedInvoiceId = searchParams.get('invoice');
  const hasOpenedDeepLink = useRef(false);

  const allInvoices = invoicesQuery.data ?? NO_INVOICES;
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;
  const vatRates = vatRatesQuery.data ?? NO_VAT_RATES;

  const invoices = useMemo(
    () =>
      allInvoices
        .filter((i) => i.fiscalYearId === fiscalYearId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allInvoices, fiscalYearId],
  );

  // Deep link (e.g. an anomaly-surfacing row) — searches the FULL,
  // fiscal-year-unfiltered list, since a flagged invoice may belong to a
  // different fiscal year than the one currently selected.
  useEffect(() => {
    if (!deepLinkedInvoiceId || hasOpenedDeepLink.current) return;
    const target = allInvoices.find((i) => i.id === deepLinkedInvoiceId);
    if (target) {
      setEditor({ mode: 'edit', invoice: target });
      hasOpenedDeepLink.current = true;
    }
  }, [deepLinkedInvoiceId, allInvoices]);

  const selectedId =
    editor.mode === 'edit' || editor.mode === 'credit-note' ? editor.invoice.id : null;

  function openInvoice(invoice: Invoice) {
    setEditor({ mode: 'edit', invoice });
  }

  async function handleDelete(invoice: Invoice) {
    const label = invoice.invoiceNumber ?? invoice.id;
    if (!window.confirm(`Supprimer le brouillon « ${label} » ? Cette action est irréversible.`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteInvoice.mutateAsync(invoice.id);
      if (editor.mode === 'edit' && editor.invoice.id === invoice.id) {
        setEditor({ mode: 'closed' });
      }
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'La suppression a échoué.');
    }
  }

  const isLoading = accountsQuery.isLoading || vatRatesQuery.isLoading || fiscalYearsLoading;

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
        <div className="h-6 w-40 animate-pulse rounded-md bg-border" />
        <div className="h-64 w-full animate-pulse rounded-lg bg-border" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Factures</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Facturation clients — génération conforme et rattachement automatique au grand livre.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditor({ mode: 'new' })}
          disabled={!fiscalYearId}
          className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
        >
          + Nouvelle facture
        </button>
      </header>

      {currentCompany?.jurisdiction === 'MC' && (
        <div className="rounded-md bg-warning-soft px-4 py-3 text-[13px] text-warning">
          Les règles de facturation monégasques sont en attente de confirmation officielle — les
          brouillons peuvent être créés et modifiés, mais la finalisation est bloquée. Voir
          specs/invoicing-plan.md §1.6.
        </div>
      )}

      {actionError && (
        <div className="rounded-md bg-negative-soft px-4 py-3 text-[13px] text-negative">
          {actionError}
        </div>
      )}

      {editor.mode === 'new' && fiscalYearId && (
        <InvoiceEditor
          fiscalYearId={fiscalYearId}
          accounts={accounts}
          vatRates={vatRates}
          existing={null}
          onSaved={() => setEditor({ mode: 'closed' })}
          onCancel={() => setEditor({ mode: 'closed' })}
        />
      )}

      {editor.mode === 'credit-note' && fiscalYearId && (
        <InvoiceEditor
          fiscalYearId={fiscalYearId}
          accounts={accounts}
          vatRates={vatRates}
          existing={null}
          creditNoteFor={editor.invoice}
          onSaved={() => setEditor({ mode: 'closed' })}
          onCancel={() => setEditor({ mode: 'closed' })}
        />
      )}

      {editor.mode === 'edit' && fiscalYearId && editor.invoice.status === 'DRAFT' && (
        <InvoiceEditor
          key={editor.invoice.id}
          fiscalYearId={fiscalYearId}
          accounts={accounts}
          vatRates={vatRates}
          existing={editor.invoice}
          onSaved={(saved) => setEditor({ mode: 'edit', invoice: saved })}
          onCancel={() => setEditor({ mode: 'closed' })}
        />
      )}

      {editor.mode === 'edit' && editor.invoice.status === 'FINALIZED' && (
        <InvoiceDetailView
          invoice={editor.invoice}
          onCreateCreditNote={() => setEditor({ mode: 'credit-note', invoice: editor.invoice })}
          onEncaisseMarked={(updated) => setEditor({ mode: 'edit', invoice: updated })}
        />
      )}

      <InvoicesList
        invoices={invoices}
        accounts={accounts}
        selectedId={selectedId}
        onSelect={openInvoice}
        onDelete={handleDelete}
      />
    </div>
  );
}
