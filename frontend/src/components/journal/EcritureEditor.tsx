import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Account, Ecriture, VatRate } from '../../api/types';
import type { CreateEcritureDto, CreateEcritureLigneDto, CreateTiersDto } from '../../api/dto';
import { useCreateEcriture, useCreateTiers, useUpdateEcriture, useVatRates } from '../../api/queries';
import { ApiError } from '../../api/client';
import {
  addMoneyStrings,
  formatMoneyFr,
  isZeroMoney,
  normalizeMoneyInput,
  sanitizeAmountBuffer,
} from '../../lib/money';
import { isAuxiliaryBearingAccount } from '../../lib/accounts';
import { AccountCombobox } from './AccountCombobox';
import { BalanceIndicator } from './BalanceIndicator';

interface DraftLigne {
  key: string;
  compteId: string | null;
  compteAuxId: string | null;
  debit: string;
  credit: string;
  lettrage: string;
  vatRateId: string | null;
  /** ISO date string, or '' when unset — feeds the 2057 maturity split. */
  dateEcheance: string;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `l${keySeq}`;
}

function emptyLigne(): DraftLigne {
  return {
    key: nextKey(),
    compteId: null,
    compteAuxId: null,
    debit: '',
    credit: '',
    lettrage: '',
    vatRateId: null,
    dateEcheance: '',
  };
}

/**
 * A line's TVA rate only matters for a collectée line (account 4457x)
 * or a produit line (class 7) — see computeCa3Declaration on the
 * backend. Shown only then so the column doesn't imply every line needs
 * a rate.
 */
function lineNeedsVatRate(account: Account | undefined): boolean {
  return Boolean(account && (account.number.startsWith('4457') || account.pcgClass === 7));
}

/**
 * A due date only matters for a créance/dette line — class 4 (tiers:
 * clients, fournisseurs, personnel, état, groupe et associés, ...) or a
 * class-1 loan account (16x) — feeding 2057's Cadre A/B maturity split.
 * Shown only then, same "don't imply every line needs it" pattern as
 * lineNeedsVatRate above.
 */
function lineNeedsDueDate(account: Account | undefined): boolean {
  return Boolean(account && (account.pcgClass === 4 || account.number.startsWith('16')));
}

function toIsoDate(value: string): string {
  return value.slice(0, 10);
}

function fromExisting(ecriture: Ecriture): DraftLigne[] {
  return ecriture.lignes.map((ligne) => ({
    key: nextKey(),
    compteId: ligne.compteId,
    compteAuxId: ligne.compteAuxId,
    debit: isZeroMoney(ligne.debit) ? '' : ligne.debit.replace('.', ','),
    credit: isZeroMoney(ligne.credit) ? '' : ligne.credit.replace('.', ','),
    lettrage: ligne.lettrage ?? '',
    vatRateId: ligne.vatRateId,
    dateEcheance: ligne.dateEcheance ? toIsoDate(ligne.dateEcheance) : '',
  }));
}

function formatVatRateOption(rate: VatRate): string {
  return `${rate.ratePercent.replace('.', ',')} % — ${rate.label}`;
}

function isRowEmpty(row: DraftLigne): boolean {
  return !row.compteId && row.debit === '' && row.credit === '' && row.lettrage === '';
}

function isRowValid(row: DraftLigne, accounts: Account[]): boolean {
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

export function EcritureEditor({
  journalId,
  fiscalYearId,
  accounts,
  existing,
  onSaved,
  onCancel,
}: {
  journalId: string;
  fiscalYearId: string;
  accounts: Account[];
  existing: Ecriture | null;
  onSaved: (warnings: string[]) => void;
  onCancel: () => void;
}) {
  const [ecritureDate, setEcritureDate] = useState(
    existing ? toIsoDate(existing.ecritureDate) : new Date().toISOString().slice(0, 10),
  );
  const [pieceRef, setPieceRef] = useState(existing?.pieceRef ?? '');
  const [libelle, setLibelle] = useState(existing?.libelle ?? '');
  const [lignes, setLignes] = useState<DraftLigne[]>(
    existing ? fromExisting(existing) : [emptyLigne(), emptyLigne()],
  );
  const [submitError, setSubmitError] = useState<string[] | null>(null);

  const accountInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const debitInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const createEcriture = useCreateEcriture();
  const updateEcriture = useUpdateEcriture();
  const createTiers = useCreateTiers();
  const vatRatesQuery = useVatRates();
  const vatRates = useMemo(
    () => [...(vatRatesQuery.data ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
    [vatRatesQuery.data],
  );
  const isSaving = createEcriture.isPending || updateEcriture.isPending;
  const readOnly = Boolean(existing?.validatedAt);

  const nonEmptyRows = useMemo(() => lignes.filter((row) => !isRowEmpty(row)), [lignes]);

  const totals = useMemo(
    () => ({
      debit: nonEmptyRows.reduce((sum, row) => addMoneyStrings(sum, row.debit || '0.00'), '0.00'),
      credit: nonEmptyRows.reduce(
        (sum, row) => addMoneyStrings(sum, row.credit || '0.00'),
        '0.00',
      ),
    }),
    [nonEmptyRows],
  );

  const balanced = totals.debit === totals.credit;
  const allRowsValid = nonEmptyRows.every((row) => isRowValid(row, accounts));
  const canSubmit =
    !readOnly &&
    nonEmptyRows.length >= 2 &&
    allRowsValid &&
    balanced &&
    !isZeroMoney(totals.debit) &&
    libelle.trim() !== '' &&
    ecritureDate !== '';

  function updateRow(index: number, patch: Partial<DraftLigne>) {
    setLignes((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function selectMainAccount(index: number, compteId: string) {
    const account = accounts.find((a) => a.id === compteId);
    const stillNeedsAux = account && isAuxiliaryBearingAccount(account);
    updateRow(index, { compteId, ...(stillNeedsAux ? {} : { compteAuxId: null }) });
  }

  function addRow(focus: boolean) {
    setLignes((rows) => [...rows, emptyLigne()]);
    if (focus) {
      requestAnimationFrame(() => {
        accountInputRefs.current[lignes.length]?.focus();
      });
    }
  }

  function removeRow(index: number) {
    if (lignes.length <= 2) return;
    setLignes((rows) => rows.filter((_, i) => i !== index));
  }

  function handleLastCellKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (index === lignes.length - 1) {
      addRow(true);
    } else {
      accountInputRefs.current[index + 1]?.focus();
    }
  }

  async function handleSubmit() {
    setSubmitError(null);
    const lignesDto: CreateEcritureLigneDto[] = nonEmptyRows.map((row) => ({
      compteId: row.compteId!,
      compteAuxId: row.compteAuxId ?? undefined,
      debit: isZeroMoney(row.debit || '0') ? undefined : normalizeMoneyInput(row.debit),
      credit: isZeroMoney(row.credit || '0') ? undefined : normalizeMoneyInput(row.credit),
      lettrage: row.lettrage.trim() === '' ? undefined : row.lettrage.trim(),
      vatRateId: row.vatRateId ?? undefined,
      dateEcheance: row.dateEcheance === '' ? undefined : row.dateEcheance,
    }));
    const dto: CreateEcritureDto = {
      journalId,
      fiscalYearId,
      ecritureDate,
      pieceRef: pieceRef.trim() === '' ? undefined : pieceRef.trim(),
      libelle: libelle.trim(),
      lignes: lignesDto,
    };

    try {
      const result = existing
        ? await updateEcriture.mutateAsync({ id: existing.id, dto })
        : await createEcriture.mutateAsync(dto);
      onSaved(result.warnings);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.details : ['Une erreur est survenue.']);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-end gap-4 border-b border-border px-5 py-4">
        <Field label="Date">
          <input
            type="date"
            value={ecritureDate}
            disabled={readOnly}
            onChange={(e) => setEcritureDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:text-ink-faint"
          />
        </Field>
        <Field label="Référence pièce">
          <input
            type="text"
            value={pieceRef}
            disabled={readOnly}
            onChange={(e) => setPieceRef(e.target.value)}
            placeholder="FA-2026-014"
            className="w-40 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:text-ink-faint"
          />
        </Field>
        <Field label="Libellé" grow>
          <input
            type="text"
            value={libelle}
            disabled={readOnly}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Achat fournitures de bureau"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:text-ink-faint"
          />
        </Field>
        {existing && (
          <div className="ml-auto text-[12px] text-ink-faint">
            {existing.ecritureNum ? `Écriture n° ${existing.ecritureNum}` : 'Brouillon'}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="w-[26%] px-3 py-2 font-semibold">Compte</th>
              <th className="w-[16%] px-3 py-2 font-semibold">Tiers</th>
              <th className="w-[13%] px-3 py-2 text-right font-semibold">Débit</th>
              <th className="w-[13%] px-3 py-2 text-right font-semibold">Crédit</th>
              <th className="w-20 px-3 py-2 font-semibold">Lettrage</th>
              <th className="w-24 px-3 py-2 font-semibold">TVA</th>
              <th className="w-32 px-3 py-2 font-semibold">Échéance</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((row, index) => {
              const invalidBoth = !isZeroMoney(row.debit || '0') && !isZeroMoney(row.credit || '0');
              const mainAccount = accounts.find((a) => a.id === row.compteId);
              const needsAux = Boolean(mainAccount && isAuxiliaryBearingAccount(mainAccount));
              // Scoped to *this row's* collectif — a 401 line must only ever
              // offer 401 tiers, never 411 tiers picked up from another row.
              const rowAuxAccounts = mainAccount
                ? accounts.filter((a) => a.isAuxiliary && a.parentId === mainAccount.id)
                : [];
              const needsVatRate = lineNeedsVatRate(mainAccount);
              const needsDueDate = lineNeedsDueDate(mainAccount);
              return (
                <tr key={row.key} className="border-b border-border last:border-b-0 hover:bg-bg/60">
                  <td className="p-0">
                    <AccountCombobox
                      ref={(el) => {
                        accountInputRefs.current[index] = el;
                      }}
                      accounts={accounts}
                      value={row.compteId}
                      onSelect={(id) => selectMainAccount(index, id)}
                      onNavigateNext={() => debitInputRefs.current[index]?.focus()}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="p-0">
                    {needsAux ? (
                      <AccountCombobox
                        accounts={rowAuxAccounts}
                        value={row.compteAuxId}
                        onSelect={(id) => updateRow(index, { compteAuxId: id })}
                        placeholder="N° tiers"
                        disabled={readOnly}
                        createLabel="nouveau tiers"
                        onCreateNew={
                          mainAccount
                            ? (label) =>
                                createTiers.mutateAsync({
                                  parentId: mainAccount.id,
                                  dto: { label } satisfies CreateTiersDto,
                                })
                            : undefined
                        }
                      />
                    ) : (
                      <span className="block px-2 py-1.5 text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="p-0">
                    <input
                      ref={(el) => {
                        debitInputRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="decimal"
                      disabled={readOnly}
                      value={row.debit}
                      onChange={(e) =>
                        updateRow(index, { debit: sanitizeAmountBuffer(e.target.value) })
                      }
                      onKeyDown={(e) => handleLastCellKeyDown(e, index)}
                      placeholder="0,00"
                      className={[
                        'w-full bg-transparent px-3 py-1.5 text-right tabular-nums text-ink outline-none placeholder:text-ink-faint disabled:text-ink-faint',
                        invalidBoth ? 'text-negative' : '',
                      ].join(' ')}
                    />
                  </td>
                  <td className="p-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={readOnly}
                      value={row.credit}
                      onChange={(e) =>
                        updateRow(index, { credit: sanitizeAmountBuffer(e.target.value) })
                      }
                      onKeyDown={(e) => handleLastCellKeyDown(e, index)}
                      placeholder="0,00"
                      className={[
                        'w-full bg-transparent px-3 py-1.5 text-right tabular-nums text-ink outline-none placeholder:text-ink-faint disabled:text-ink-faint',
                        invalidBoth ? 'text-negative' : '',
                      ].join(' ')}
                    />
                  </td>
                  <td className="p-0">
                    <input
                      type="text"
                      disabled={readOnly}
                      value={row.lettrage}
                      onChange={(e) => updateRow(index, { lettrage: e.target.value })}
                      onKeyDown={(e) => handleLastCellKeyDown(e, index)}
                      placeholder="—"
                      className="w-full bg-transparent px-3 py-1.5 text-ink outline-none placeholder:text-ink-faint disabled:text-ink-faint"
                    />
                  </td>
                  <td className="p-0">
                    {needsVatRate ? (
                      <select
                        disabled={readOnly}
                        value={row.vatRateId ?? ''}
                        onChange={(e) =>
                          updateRow(index, { vatRateId: e.target.value === '' ? null : e.target.value })
                        }
                        className="w-full bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none disabled:text-ink-faint"
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
                  <td className="p-0">
                    {needsDueDate ? (
                      <input
                        type="date"
                        disabled={readOnly}
                        value={row.dateEcheance}
                        onChange={(e) => updateRow(index, { dateEcheance: e.target.value })}
                        className="w-full bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none disabled:text-ink-faint"
                      />
                    ) : (
                      <span className="block px-2 py-1.5 text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-1 text-center">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        disabled={lignes.length <= 2}
                        aria-label="Supprimer la ligne"
                        className="rounded p-1 text-ink-faint hover:bg-negative-soft hover:text-negative disabled:cursor-not-allowed disabled:opacity-0"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <path
                            d="M3 3.5h8M5.5 3.5v-1h3v1M4.5 3.5 5 11h4l.5-7.5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!readOnly && (
          <button
            type="button"
            onClick={() => addRow(true)}
            className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-left text-[12.5px] font-medium text-ink-muted hover:bg-bg hover:text-accent"
          >
            <span className="text-[15px] leading-none">+</span> Ajouter une ligne
          </button>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-4 border-t border-border bg-surface px-5 py-3.5">
        <div className="flex items-center gap-5 text-[13px] tabular-nums text-ink-muted">
          <span>
            Débit <span className="font-semibold text-ink">{formatMoneyFr(totals.debit)}</span>
          </span>
          <span>
            Crédit <span className="font-semibold text-ink">{formatMoneyFr(totals.credit)}</span>
          </span>
        </div>
        <BalanceIndicator totalDebit={totals.debit} totalCredit={totals.credit} />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
          >
            Annuler
          </button>
          {!readOnly && (
            <button
              type="button"
              disabled={!canSubmit || isSaving}
              onClick={handleSubmit}
              className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {isSaving ? 'Enregistrement…' : 'Enregistrer le brouillon'}
            </button>
          )}
        </div>
      </div>

      {submitError && (
        <div className="border-t border-negative-soft bg-negative-soft px-5 py-3 text-[12.5px] text-negative">
          {submitError.map((message, i) => (
            <div key={i}>{message}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  grow,
}: {
  label: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <label className={grow ? 'flex flex-1 flex-col gap-1' : 'flex flex-col gap-1'}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
