import { Fragment, useState } from 'react';
import type { Budget } from '../api/types';
import {
  useAccounts,
  useBudgetVariance,
  useBudgets,
  useDeleteBudget,
  useFiscalYears,
} from '../api/queries';
import { ApiError } from '../api/client';
import { addMoneyStrings, formatMoneyFr } from '../lib/money';
import { BudgetEditor } from '../components/budgeting/BudgetEditor';
import { BudgetVarianceView } from '../components/budgeting/BudgetVarianceView';

type EditorState = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; budget: Budget };

const NO_BUDGETS: never[] = [];
const NO_ACCOUNTS: never[] = [];
const NO_FISCAL_YEARS: never[] = [];

/**
 * Budgeting / forecasting vs. actuals — roadmap item 2c, see CLAUDE.md
 * "Budgeting / forecasting". A top-level "Déclarations & pilotage" nav
 * item, alongside Analyse financière — this is a REPORT (planned vs.
 * real figures, same shape as every other pilotage screen), not an
 * admin screen, so it doesn't live under Paramètres the way Modèles
 * récurrents/Comptes & journaux do.
 */
export function BudgetPage() {
  const budgetsQuery = useBudgets();
  const accountsQuery = useAccounts();
  const fiscalYearsQuery = useFiscalYears();
  const deleteBudget = useDeleteBudget();

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const varianceQuery = useBudgetVariance(selectedBudgetId);

  const budgets = budgetsQuery.data ?? NO_BUDGETS;
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;
  const fiscalYears = fiscalYearsQuery.data ?? NO_FISCAL_YEARS;

  const fiscalYearLabel = (id: string) => fiscalYears.find((fy) => fy.id === id)?.label ?? '—';

  function toggleSelected(budget: Budget) {
    setSelectedBudgetId((current) => (current === budget.id ? null : budget.id));
  }

  async function handleDelete(budget: Budget) {
    if (!window.confirm(`Supprimer le budget « ${budget.label} » ? Cette action est irréversible.`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteBudget.mutateAsync(budget.id);
      if (editor.mode === 'edit' && editor.budget.id === budget.id) {
        setEditor({ mode: 'closed' });
      }
      if (selectedBudgetId === budget.id) {
        setSelectedBudgetId(null);
      }
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'La suppression a échoué.');
    }
  }

  const isLoading = accountsQuery.isLoading || fiscalYearsQuery.isLoading;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Budget</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Montants planifiés par compte, par exercice — comparés au grand livre réel. Un budget
            est une donnée métier, jamais une écriture.
          </p>
        </div>
        {!isLoading && (
          <button
            type="button"
            onClick={() => setEditor({ mode: 'new' })}
            disabled={fiscalYears.length === 0}
            className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            + Nouveau budget
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
            <BudgetEditor
              accounts={accounts}
              fiscalYears={fiscalYears}
              existing={null}
              onSaved={() => setEditor({ mode: 'closed' })}
              onCancel={() => setEditor({ mode: 'closed' })}
            />
          )}
          {editor.mode === 'edit' && (
            <BudgetEditor
              key={editor.budget.id}
              accounts={accounts}
              fiscalYears={fiscalYears}
              existing={editor.budget}
              onSaved={() => setEditor({ mode: 'closed' })}
              onCancel={() => setEditor({ mode: 'closed' })}
            />
          )}

          {budgets.length === 0 && editor.mode === 'closed' ? (
            <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
              Aucun budget pour l&rsquo;instant.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-bg/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-2.5">Nom</th>
                    <th className="px-4 py-2.5">Exercice</th>
                    <th className="px-4 py-2.5">Comptes</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {budgets.map((budget) => (
                    <Fragment key={budget.id}>
                      <tr
                        className="cursor-pointer border-b border-border last:border-b-0 hover:bg-bg/60"
                        onClick={() => toggleSelected(budget)}
                      >
                        <td className="px-4 py-2.5 font-medium text-ink">
                          {selectedBudgetId === budget.id ? '▾' : '▸'} {budget.label}
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          {fiscalYearLabel(budget.fiscalYearId)}
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          {budget.lines.length} · {formatMoneyFr(totalPlanned(budget))}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditor({ mode: 'edit', budget });
                            }}
                            className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-faint hover:bg-bg hover:text-accent"
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDelete(budget);
                            }}
                            className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-faint hover:bg-negative-soft hover:text-negative"
                          >
                            Supprimer
                          </button>
                        </td>
                      </tr>
                      {selectedBudgetId === budget.id && (
                        <tr className="border-b border-border last:border-b-0">
                          <td colSpan={4} className="bg-bg/40 p-4">
                            {varianceQuery.isLoading ? (
                              <div className="h-24 w-full animate-pulse rounded-lg bg-border" />
                            ) : varianceQuery.isError ? (
                              <div className="rounded-md bg-negative-soft px-3.5 py-2.5 text-[12.5px] text-negative">
                                {varianceQuery.error instanceof ApiError
                                  ? varianceQuery.error.message
                                  : 'La comparaison avec le réel a échoué.'}
                              </div>
                            ) : varianceQuery.data ? (
                              <BudgetVarianceView report={varianceQuery.data} />
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </Fragment>
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

function totalPlanned(budget: Budget): string {
  return budget.lines.reduce((sum, l) => addMoneyStrings(sum, l.plannedAmount), '0.00');
}
