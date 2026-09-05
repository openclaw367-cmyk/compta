import { useState } from 'react';
import type { RecurringEntryTemplate } from '../api/types';
import {
  useAccounts,
  useDeleteRecurringTemplate,
  useJournals,
  useRecurringTemplates,
  useVatRates,
} from '../api/queries';
import { ApiError } from '../api/client';
import { addMoneyStrings, formatMoneyFr } from '../lib/money';
import { TemplateEditor } from '../components/recurring/TemplateEditor';

type EditorState = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; template: RecurringEntryTemplate };

const NO_TEMPLATES: never[] = [];
const NO_JOURNALS: never[] = [];
const NO_ACCOUNTS: never[] = [];
const NO_VAT_RATES: never[] = [];

/**
 * Recurring entry templates — see CLAUDE.md "Recurring entries /
 * templates". Reachable from Paramètres, same "lightweight admin
 * screen" convention as Comptes & journaux / TVA — Taux, not the main
 * sidebar nav. Applying a template happens from the journal grid
 * (JournalEntriesPage's "Depuis un modèle" flow) — this screen is only
 * create/edit/delete.
 */
export function RecurringTemplatesPage() {
  const templatesQuery = useRecurringTemplates();
  const journalsQuery = useJournals();
  const accountsQuery = useAccounts();
  const vatRatesQuery = useVatRates();
  const deleteTemplate = useDeleteRecurringTemplate();

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [actionError, setActionError] = useState<string | null>(null);

  const templates = templatesQuery.data ?? NO_TEMPLATES;
  const journals = journalsQuery.data ?? NO_JOURNALS;
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;
  const vatRates = vatRatesQuery.data ?? NO_VAT_RATES;

  const journalLabel = (id: string) => journals.find((j) => j.id === id)?.code ?? '—';

  async function handleDelete(template: RecurringEntryTemplate) {
    if (!window.confirm(`Supprimer le modèle « ${template.name} » ? Cette action est irréversible.`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteTemplate.mutateAsync(template.id);
      if (editor.mode === 'edit' && editor.template.id === template.id) {
        setEditor({ mode: 'closed' });
      }
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'La suppression a échoué.');
    }
  }

  const isLoading = journalsQuery.isLoading || accountsQuery.isLoading || vatRatesQuery.isLoading;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Modèles récurrents</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Écritures répétitives (loyer, abonnements, échéances) — appliquez un modèle depuis
            l&rsquo;écran Écritures, toujours en brouillon éditable, jamais automatiquement.
          </p>
        </div>
        {!isLoading && (
          <button
            type="button"
            onClick={() => setEditor({ mode: 'new' })}
            disabled={journals.length === 0}
            className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            + Nouveau modèle
          </button>
        )}
      </header>

      {actionError && (
        <div className="rounded-md bg-negative-soft px-4 py-3 text-[13px] text-negative">
          {actionError}
        </div>
      )}

      {isLoading ? (
        <div className="h-48 w-full animate-pulse rounded-lg bg-border" />
      ) : (
        <>
          {editor.mode === 'new' && (
            <TemplateEditor
              accounts={accounts}
              journals={journals}
              vatRates={vatRates}
              existing={null}
              onSaved={() => setEditor({ mode: 'closed' })}
              onCancel={() => setEditor({ mode: 'closed' })}
            />
          )}
          {editor.mode === 'edit' && (
            <TemplateEditor
              key={editor.template.id}
              accounts={accounts}
              journals={journals}
              vatRates={vatRates}
              existing={editor.template}
              onSaved={() => setEditor({ mode: 'closed' })}
              onCancel={() => setEditor({ mode: 'closed' })}
            />
          )}

          {templates.length === 0 && editor.mode === 'closed' ? (
            <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
              Aucun modèle pour l&rsquo;instant.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-bg/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-2.5">Nom</th>
                    <th className="px-4 py-2.5">Journal</th>
                    <th className="px-4 py-2.5">Lignes</th>
                    <th className="px-4 py-2.5">Prochaine échéance</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {templates.map((template) => (
                    <tr
                      key={template.id}
                      className="cursor-pointer border-b border-border last:border-b-0 hover:bg-bg/60"
                      onClick={() => setEditor({ mode: 'edit', template })}
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">{template.name}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{journalLabel(template.journalId)}</td>
                      <td className="px-4 py-2.5 text-ink-muted">
                        {template.lines.length} · {formatMoneyFr(totalDebit(template))}
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted">
                        {template.nextDueDate
                          ? new Date(template.nextDueDate).toLocaleDateString('fr-FR')
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(template);
                          }}
                          className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-faint hover:bg-negative-soft hover:text-negative"
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function totalDebit(template: RecurringEntryTemplate): string {
  return template.lines.reduce((sum, l) => addMoneyStrings(sum, l.debit), '0.00');
}
