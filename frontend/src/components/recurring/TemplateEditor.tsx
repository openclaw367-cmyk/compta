import { useState } from 'react';
import type { Account, Journal, RecurringEntryTemplate, RecurrenceFrequency, VatRate } from '../../api/types';
import type { CreateRecurringEntryTemplateDto, RecurringEntryTemplateLineDto } from '../../api/dto';
import { useCreateRecurringTemplate, useUpdateRecurringTemplate } from '../../api/queries';
import { ApiError } from '../../api/client';
import { isZeroMoney, sanitizeAmountBuffer, normalizeMoneyInput } from '../../lib/money';
import { isAuxiliaryBearingAccount, lineNeedsVatRate } from '../../lib/accounts';
import { formatVatRateOption } from '../../lib/vatRates';
import { AccountCombobox } from '../journal/AccountCombobox';

interface DraftLine {
  key: string;
  compteId: string | null;
  compteAuxId: string | null;
  debit: string;
  credit: string;
  vatRateId: string | null;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `tl${keySeq}`;
}

function emptyLine(): DraftLine {
  return { key: nextKey(), compteId: null, compteAuxId: null, debit: '', credit: '', vatRateId: null };
}

/** The only place this app translates a template's stored account NUMBER
 *  back to a live Account id for display — see CLAUDE.md "Recurring
 *  entries / templates" for why templates store numbers, not ids. A
 *  number that no longer resolves (an account renamed/deleted since)
 *  leaves the combobox blank, honestly, rather than guessing. */
function linesFromExisting(template: RecurringEntryTemplate, accounts: Account[]): DraftLine[] {
  return template.lines.map((line) => {
    const account = accounts.find((a) => a.number === line.accountNumber);
    const aux = line.auxAccountNumber ? accounts.find((a) => a.number === line.auxAccountNumber) : null;
    return {
      key: nextKey(),
      compteId: account?.id ?? null,
      compteAuxId: aux?.id ?? null,
      debit: isZeroMoney(line.debit) ? '' : line.debit.replace('.', ','),
      credit: isZeroMoney(line.credit) ? '' : line.credit.replace('.', ','),
      vatRateId: line.vatRateId,
    };
  });
}

function isRowValid(row: DraftLine, accounts: Account[]): boolean {
  if (!row.compteId) return false;
  const debit = normalizeMoneyInput(row.debit || '0');
  const credit = normalizeMoneyInput(row.credit || '0');
  const hasDebit = !isZeroMoney(debit || '0.00');
  const hasCredit = !isZeroMoney(credit || '0.00');
  if (hasDebit === hasCredit) return false;
  const mainAccount = accounts.find((a) => a.id === row.compteId);
  if (mainAccount && isAuxiliaryBearingAccount(mainAccount) && !row.compteAuxId) return false;
  return true;
}

const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  MONTHLY: 'Mensuelle',
  QUARTERLY: 'Trimestrielle',
  YEARLY: 'Annuelle',
};

const MONTH_LABELS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

/**
 * Create/edit form for a RecurringEntryTemplate — see CLAUDE.md
 * "Recurring entries / templates". Deliberately lighter than
 * EcritureEditor: no lettrage/dateEcheance/document-attach/Comptable IA,
 * since a template is metadata, not a real écriture. Reuses
 * AccountCombobox exactly as EcritureEditor does — the only translation
 * between account NUMBER (what's stored) and Account id (what the
 * combobox needs) happens here, isolated to this one component.
 */
export function TemplateEditor({
  accounts,
  journals,
  vatRates,
  existing,
  onSaved,
  onCancel,
}: {
  accounts: Account[];
  journals: Journal[];
  vatRates: VatRate[];
  existing: RecurringEntryTemplate | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [journalId, setJournalId] = useState(existing?.journalId ?? journals[0]?.id ?? '');
  const [libelle, setLibelle] = useState(existing?.libelle ?? '');
  const [frequency, setFrequency] = useState<RecurrenceFrequency | ''>(existing?.frequency ?? '');
  const [anchorDay, setAnchorDay] = useState(existing?.anchorDay ? String(existing.anchorDay) : '');
  const [anchorMonth, setAnchorMonth] = useState(
    existing?.anchorMonth ? String(existing.anchorMonth) : '',
  );
  const [lines, setLines] = useState<DraftLine[]>(
    existing ? linesFromExisting(existing, accounts) : [emptyLine(), emptyLine()],
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createTemplate = useCreateRecurringTemplate();
  const updateTemplate = useUpdateRecurringTemplate();
  const isSaving = createTemplate.isPending || updateTemplate.isPending;

  const nonEmptyLines = lines.filter((l) => l.compteId || l.debit !== '' || l.credit !== '');
  const allRowsValid = nonEmptyLines.every((row) => isRowValid(row, accounts));
  const needsAnchorMonth = frequency === 'QUARTERLY' || frequency === 'YEARLY';
  const canSubmit =
    name.trim() !== '' &&
    journalId !== '' &&
    libelle.trim() !== '' &&
    nonEmptyLines.length >= 2 &&
    allRowsValid &&
    (!frequency || (anchorDay !== '' && (!needsAnchorMonth || anchorMonth !== '')));

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function selectMainAccount(index: number, compteId: string) {
    const account = accounts.find((a) => a.id === compteId);
    const stillNeedsAux = account && isAuxiliaryBearingAccount(account);
    updateLine(index, { compteId, ...(stillNeedsAux ? {} : { compteAuxId: null }) });
  }

  function addLine() {
    setLines((rows) => [...rows, emptyLine()]);
  }

  function removeLine(index: number) {
    if (lines.length <= 2) return;
    setLines((rows) => rows.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setSubmitError(null);
    const lineDtos: RecurringEntryTemplateLineDto[] = nonEmptyLines.map((row) => {
      const account = accounts.find((a) => a.id === row.compteId)!;
      const aux = row.compteAuxId ? accounts.find((a) => a.id === row.compteAuxId) : undefined;
      return {
        accountNumber: account.number,
        auxAccountNumber: aux?.number,
        vatRateId: row.vatRateId ?? undefined,
        debit: isZeroMoney(row.debit || '0') ? undefined : normalizeMoneyInput(row.debit),
        credit: isZeroMoney(row.credit || '0') ? undefined : normalizeMoneyInput(row.credit),
      };
    });
    const dto: CreateRecurringEntryTemplateDto = {
      name: name.trim(),
      journalId,
      libelle: libelle.trim(),
      frequency: frequency === '' ? undefined : frequency,
      anchorDay: anchorDay === '' ? undefined : Number(anchorDay),
      anchorMonth: needsAnchorMonth && anchorMonth !== '' ? Number(anchorMonth) : undefined,
      lines: lineDtos,
    };
    try {
      if (existing) {
        await updateTemplate.mutateAsync({ id: existing.id, dto });
      } else {
        await createTemplate.mutateAsync(dto);
      }
      onSaved();
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Une erreur est survenue.');
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-elevated">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nom du modèle">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Loyer bureau"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </Field>
        <Field label="Journal">
          <select
            value={journalId}
            onChange={(e) => setJournalId(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          >
            {journals.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} — {j.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Libellé" grow>
          <input
            type="text"
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Loyer bureau — [mois]"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <Field label="Récurrence (indicative)">
          <select
            value={frequency}
            onChange={(e) => {
              const value = e.target.value as RecurrenceFrequency | '';
              setFrequency(value);
              if (value === 'MONTHLY') setAnchorMonth('');
            }}
            className="w-40 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          >
            <option value="">Aucune</option>
            {(Object.keys(FREQUENCY_LABELS) as RecurrenceFrequency[]).map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
        </Field>
        {frequency !== '' && (
          <Field label="Jour">
            <input
              type="number"
              min={1}
              max={31}
              value={anchorDay}
              onChange={(e) => setAnchorDay(e.target.value)}
              className="w-20 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
          </Field>
        )}
        {needsAnchorMonth && (
          <Field label={frequency === 'QUARTERLY' ? 'Mois du trimestre' : 'Mois'}>
            <select
              value={anchorMonth}
              onChange={(e) => setAnchorMonth(e.target.value)}
              className="w-44 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            >
              <option value="">—</option>
              {frequency === 'QUARTERLY'
                ? [1, 2, 3].map((m) => (
                    <option key={m} value={m}>
                      {m}{m === 1 ? 'er' : 'e'} mois du trimestre
                    </option>
                  ))
                : MONTH_LABELS.map((label, i) => (
                    <option key={label} value={i + 1}>
                      {label}
                    </option>
                  ))}
            </select>
          </Field>
        )}
        {frequency !== '' && (
          <p className="text-[12px] text-ink-faint">
            Purement indicatif — n&rsquo;applique jamais automatiquement le modèle.
          </p>
        )}
      </div>

      <div className="overflow-x-auto border-t border-border pt-1">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="w-[30%] px-3 py-2">Compte</th>
              <th className="w-[18%] px-3 py-2">Tiers</th>
              <th className="w-[15%] px-3 py-2 text-right">Débit</th>
              <th className="w-[15%] px-3 py-2 text-right">Crédit</th>
              <th className="w-[16%] px-3 py-2">TVA</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((row, index) => {
              const mainAccount = accounts.find((a) => a.id === row.compteId);
              const needsAux = Boolean(mainAccount && isAuxiliaryBearingAccount(mainAccount));
              const rowAuxAccounts = mainAccount
                ? accounts.filter((a) => a.isAuxiliary && a.parentId === mainAccount.id)
                : [];
              const needsVatRate = lineNeedsVatRate(mainAccount);
              return (
                <tr key={row.key} className="border-b border-border last:border-b-0">
                  <td className="p-0">
                    <AccountCombobox
                      accounts={accounts}
                      value={row.compteId}
                      onSelect={(id) => selectMainAccount(index, id)}
                    />
                  </td>
                  <td className="p-0">
                    {needsAux ? (
                      <AccountCombobox
                        accounts={rowAuxAccounts}
                        value={row.compteAuxId}
                        onSelect={(id) => updateLine(index, { compteAuxId: id })}
                        placeholder="N° tiers"
                      />
                    ) : (
                      <span className="block px-2 py-1.5 text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="p-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.debit}
                      onChange={(e) => updateLine(index, { debit: sanitizeAmountBuffer(e.target.value) })}
                      placeholder="0,00"
                      className="w-full bg-transparent px-3 py-1.5 text-right tabular-nums text-ink outline-none placeholder:text-ink-faint"
                    />
                  </td>
                  <td className="p-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.credit}
                      onChange={(e) => updateLine(index, { credit: sanitizeAmountBuffer(e.target.value) })}
                      placeholder="0,00"
                      className="w-full bg-transparent px-3 py-1.5 text-right tabular-nums text-ink outline-none placeholder:text-ink-faint"
                    />
                  </td>
                  <td className="p-0">
                    {needsVatRate ? (
                      <select
                        value={row.vatRateId ?? ''}
                        onChange={(e) =>
                          updateLine(index, { vatRateId: e.target.value === '' ? null : e.target.value })
                        }
                        className="w-full bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none"
                      >
                        <option value="">—</option>
                        {vatRates.map((rate) => (
                          <option key={rate.id} value={rate.id}>
                            {formatVatRateOption(rate)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="block px-2 py-1.5 text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      disabled={lines.length <= 2}
                      aria-label="Supprimer la ligne"
                      className="rounded p-1 text-ink-faint hover:bg-negative-soft hover:text-negative disabled:cursor-not-allowed disabled:opacity-0"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addLine}
          className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-left text-[12.5px] font-medium text-ink-muted hover:bg-bg hover:text-accent"
        >
          <span className="text-[15px] leading-none">+</span> Ajouter une ligne
        </button>
      </div>

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
          {isSaving ? 'Enregistrement…' : existing ? 'Enregistrer' : 'Créer le modèle'}
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

function Field({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <label className={grow ? 'flex flex-1 flex-col gap-1' : 'flex flex-col gap-1'}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
