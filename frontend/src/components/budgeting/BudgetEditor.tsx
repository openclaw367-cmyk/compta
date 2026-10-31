import { useState } from 'react';
import type { Account, Budget, FiscalYear } from '../../api/types';
import type { BudgetLineDto, CreateBudgetDto } from '../../api/dto';
import { useCreateBudget, useUpdateBudget } from '../../api/queries';
import { ApiError } from '../../api/client';
import { isZeroMoney, sanitizeAmountBuffer, normalizeMoneyInput } from '../../lib/money';
import { AccountCombobox } from '../journal/AccountCombobox';

interface DraftLine {
  key: string;
  accountId: string | null;
  plannedAmount: string;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `bl${keySeq}`;
}

function emptyLine(): DraftLine {
  return { key: nextKey(), accountId: null, plannedAmount: '' };
}

function linesFromExisting(budget: Budget): DraftLine[] {
  return budget.lines.map((line) => ({
    key: nextKey(),
    accountId: line.accountId,
    plannedAmount: line.plannedAmount.replace('.', ','),
  }));
}

function isRowValid(row: DraftLine): boolean {
  if (!row.accountId) return false;
  const amount = normalizeMoneyInput(row.plannedAmount || '0');
  return !isZeroMoney(amount || '0.00');
}

/**
 * Create/edit form for a Budget (account-level planned amounts, one
 * fiscal year) — see CLAUDE.md "Budgeting / forecasting". Deliberately
 * lighter than EcritureEditor, same reasoning TemplateEditor already
 * gives: a budget line is just account + amount, no debit/credit/
 * journal/lettrage — this is metadata, never a real écriture. Each
 * line's `plannedAmount` is a single non-negative figure (not a
 * debit/credit pair) entered in the account's own natural reporting
 * direction — see budgeting.ts's own doc comment for the sign
 * convention the variance report compares this against.
 */
export function BudgetEditor({
  accounts,
  fiscalYears,
  existing,
  onSaved,
  onCancel,
}: {
  accounts: Account[];
  fiscalYears: FiscalYear[];
  existing: Budget | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? '');
  const [fiscalYearId, setFiscalYearId] = useState(
    existing?.fiscalYearId ?? fiscalYears[0]?.id ?? '',
  );
  const [lines, setLines] = useState<DraftLine[]>(
    existing ? linesFromExisting(existing) : [emptyLine()],
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const isSaving = createBudget.isPending || updateBudget.isPending;

  const nonEmptyLines = lines.filter((l) => l.accountId || l.plannedAmount !== '');
  const allRowsValid = nonEmptyLines.every((row) => isRowValid(row));
  const accountIds = nonEmptyLines.map((l) => l.accountId);
  const hasDuplicateAccount = new Set(accountIds).size !== accountIds.length;
  const canSubmit =
    label.trim() !== '' &&
    fiscalYearId !== '' &&
    nonEmptyLines.length >= 1 &&
    allRowsValid &&
    !hasDuplicateAccount;

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addLine() {
    setLines((rows) => [...rows, emptyLine()]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    setLines((rows) => rows.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setSubmitError(null);
    const lineDtos: BudgetLineDto[] = nonEmptyLines.map((row) => ({
      accountId: row.accountId!,
      plannedAmount: normalizeMoneyInput(row.plannedAmount),
    }));
    const dto: CreateBudgetDto = {
      fiscalYearId,
      label: label.trim(),
      lines: lineDtos,
    };
    try {
      if (existing) {
        await updateBudget.mutateAsync({ id: existing.id, dto });
      } else {
        await createBudget.mutateAsync(dto);
      }
      onSaved();
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Une erreur est survenue.');
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-elevated">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nom du budget">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Budget 2026"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </Field>
        <Field label="Exercice">
          <select
            value={fiscalYearId}
            onChange={(e) => setFiscalYearId(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          >
            {fiscalYears.map((fy) => (
              <option key={fy.id} value={fy.id}>
                {fy.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className="text-[12px] text-ink-faint">
        Montant planifié dans le sens naturel du compte — ce qu&rsquo;on prévoit de dépenser pour
        un compte de charge, ce qu&rsquo;on prévoit d&rsquo;encaisser pour un compte de produit.
      </p>

      <div className="overflow-x-auto border-t border-border pt-1">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="w-[55%] px-3 py-2">Compte</th>
              <th className="w-[35%] px-3 py-2 text-right">Montant planifié</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((row, index) => (
              <tr key={row.key} className="border-b border-border last:border-b-0">
                <td className="p-0">
                  <AccountCombobox
                    accounts={accounts}
                    value={row.accountId}
                    onSelect={(id) => updateLine(index, { accountId: id })}
                  />
                </td>
                <td className="p-0">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.plannedAmount}
                    onChange={(e) =>
                      updateLine(index, { plannedAmount: sanitizeAmountBuffer(e.target.value) })
                    }
                    placeholder="0,00"
                    className="w-full bg-transparent px-3 py-1.5 text-right tabular-nums text-ink outline-none placeholder:text-ink-faint"
                  />
                </td>
                <td className="px-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    disabled={lines.length <= 1}
                    aria-label="Supprimer la ligne"
                    className="rounded p-1 text-ink-faint hover:bg-negative-soft hover:text-negative disabled:cursor-not-allowed disabled:opacity-0"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addLine}
          className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-left text-[12.5px] font-medium text-ink-muted hover:bg-bg hover:text-accent"
        >
          <span className="text-[15px] leading-none">+</span> Ajouter un compte
        </button>
      </div>

      {hasDuplicateAccount && (
        <div className="rounded-md bg-negative-soft px-3.5 py-2.5 text-[12.5px] text-negative">
          Un même compte ne peut apparaître qu&rsquo;une seule fois dans ce budget.
        </div>
      )}

      {submitError && (
        <div className="rounded-md bg-negative-soft px-3.5 py-2.5 text-[12.5px] text-negative">
          {submitError}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canSubmit || isSaving}
          onClick={() => void handleSubmit()}
          className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
        >
          {isSaving ? 'Enregistrement…' : existing ? 'Enregistrer' : 'Créer le budget'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
