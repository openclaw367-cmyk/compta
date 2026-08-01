import { useEffect, useMemo, useState } from 'react';
import type { Ecriture } from '../api/types';
import {
  useAccounts,
  useDeleteEcriture,
  useEcritures,
  useFiscalYears,
  useJournals,
  useReverseEcriture,
  useValidateEcriture,
} from '../api/queries';
import { ApiError } from '../api/client';
import { EcrituresList } from '../components/journal/EcrituresList';
import { EcritureEditor } from '../components/journal/EcritureEditor';

type EditorState = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; ecriture: Ecriture };

// Stable empty-array fallbacks: `data ?? []` would create a new reference
// every render even when `data` itself hasn't changed, which then makes
// exhaustive-deps (rightly) treat every effect/memo keyed on it as dirty
// on every render.
const NO_JOURNALS: never[] = [];
const NO_FISCAL_YEARS: never[] = [];
const NO_ACCOUNTS: never[] = [];
const NO_ECRITURES: never[] = [];

export function JournalEntriesPage() {
  const journalsQuery = useJournals();
  const accountsQuery = useAccounts();
  const fiscalYearsQuery = useFiscalYears();
  const ecrituresQuery = useEcritures();
  const deleteEcriture = useDeleteEcriture();
  const validateEcriture = useValidateEcriture();
  const reverseEcriture = useReverseEcriture();

  const [journalId, setJournalId] = useState<string | null>(null);
  const [fiscalYearId, setFiscalYearId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const journals = journalsQuery.data ?? NO_JOURNALS;
  const fiscalYears = fiscalYearsQuery.data ?? NO_FISCAL_YEARS;
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;
  const ecritures = ecrituresQuery.data ?? NO_ECRITURES;

  useEffect(() => {
    if (!journalId && journals.length > 0) setJournalId(journals[0].id);
  }, [journalId, journals]);

  useEffect(() => {
    if (!fiscalYearId && fiscalYears.length > 0) setFiscalYearId(fiscalYears[0].id);
  }, [fiscalYearId, fiscalYears]);

  const scopedEcritures = useMemo(
    () =>
      ecritures
        .filter((e) => e.journalId === journalId && e.fiscalYearId === fiscalYearId)
        .sort((a, b) => b.ecritureDate.localeCompare(a.ecritureDate)),
    [ecritures, journalId, fiscalYearId],
  );

  const selectedFiscalYear = fiscalYears.find((fy) => fy.id === fiscalYearId);

  async function handleDelete(ecriture: Ecriture) {
    const label = ecriture.pieceRef ?? ecriture.libelle;
    if (!window.confirm(`Supprimer le brouillon « ${label} » ? Cette action est irréversible.`)) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    try {
      await deleteEcriture.mutateAsync(ecriture.id);
      if (editor.mode === 'edit' && editor.ecriture.id === ecriture.id) {
        setEditor({ mode: 'closed' });
      }
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'La suppression a échoué.');
    }
  }

  async function handleValidate(ecriture: Ecriture) {
    const label = ecriture.pieceRef ?? ecriture.libelle;
    if (
      !window.confirm(
        `Valider l'écriture « ${label} » ? Elle deviendra définitive — la seule façon de la ` +
          'corriger ensuite sera une écriture de contre-passation.',
      )
    ) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    try {
      await validateEcriture.mutateAsync(ecriture.id);
      if (editor.mode === 'edit' && editor.ecriture.id === ecriture.id) {
        setEditor({ mode: 'closed' });
      }
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'La validation a échoué.');
    }
  }

  async function handleReverse(ecriture: Ecriture) {
    const label = ecriture.pieceRef ?? ecriture.libelle;
    if (
      !window.confirm(
        `Contre-passer l'écriture « ${label} » ? Une nouvelle écriture de contre-passation ` +
          '(montants inversés) sera créée en brouillon dans le même journal, datée du jour — ' +
          "à valider séparément. L'écriture d'origine reste inchangée et définitive : la " +
          'contre-passation ne la supprime ni ne la modifie.',
      )
    ) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    try {
      const reversal = await reverseEcriture.mutateAsync(ecriture.id);
      setActionSuccess(
        `Écriture de contre-passation créée en brouillon (« ${reversal.libelle} ») — ` +
          'sélectionnez-la dans la liste pour la valider.',
      );
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'La contre-passation a échoué.');
    }
  }

  const isLoading =
    journalsQuery.isLoading || accountsQuery.isLoading || fiscalYearsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Écritures</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Saisie et consultation des écritures comptables par journal.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={journalId ?? ''}
            onChange={setJournalId}
            options={journals.map((j) => ({ value: j.id, label: `${j.code} — ${j.label}` }))}
          />
          <Select
            value={fiscalYearId ?? ''}
            onChange={setFiscalYearId}
            options={fiscalYears.map((fy) => ({ value: fy.id, label: fy.label }))}
          />
          <button
            type="button"
            onClick={() => setEditor({ mode: 'new' })}
            disabled={!journalId || !fiscalYearId || Boolean(selectedFiscalYear?.closedAt)}
            className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            + Nouvelle écriture
          </button>
        </div>
      </header>

      {selectedFiscalYear?.closedAt && (
        <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
          L'exercice « {selectedFiscalYear.label} » est clôturé — lecture seule.
        </div>
      )}

      {actionError && (
        <div className="flex items-center justify-between rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-medium">
            Fermer
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="flex items-center justify-between rounded-md bg-positive-soft px-4 py-2.5 text-[13px] text-positive">
          <span>{actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess(null)} className="font-medium">
            Fermer
          </button>
        </div>
      )}

      {editor.mode !== 'closed' && journalId && fiscalYearId && (
        <EcritureEditor
          key={editor.mode === 'edit' ? editor.ecriture.id : 'new'}
          journalId={journalId}
          fiscalYearId={fiscalYearId}
          accounts={accounts}
          existing={editor.mode === 'edit' ? editor.ecriture : null}
          onSaved={() => setEditor({ mode: 'closed' })}
          onCancel={() => setEditor({ mode: 'closed' })}
        />
      )}

      <EcrituresList
        ecritures={scopedEcritures}
        selectedId={editor.mode === 'edit' ? editor.ecriture.id : null}
        onSelect={(ecriture) => setEditor({ mode: 'edit', ecriture })}
        onDelete={handleDelete}
        onValidate={handleValidate}
        onReverse={handleReverse}
      />
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
