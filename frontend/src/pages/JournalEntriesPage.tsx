import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Ecriture, Journal } from '../api/types';
import {
  useAccounts,
  useDeleteEcriture,
  useEcritures,
  useJournals,
  useReverseEcriture,
  useValidateEcriture,
} from '../api/queries';
import { ApiError } from '../api/client';
import { EcrituresList } from '../components/journal/EcrituresList';
import { EcritureEditor } from '../components/journal/EcritureEditor';
import { useAppContext } from '../context/appContextStore';

type EditorState = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; ecriture: Ecriture };

// Stable empty-array fallbacks: `data ?? []` would create a new reference
// every render even when `data` itself hasn't changed, which then makes
// exhaustive-deps (rightly) treat every effect/memo keyed on it as dirty
// on every render.
const NO_JOURNALS: never[] = [];
const NO_ACCOUNTS: never[] = [];
const NO_ECRITURES: never[] = [];

export function JournalEntriesPage() {
  const { fiscalYears, fiscalYearId, fiscalYearsLoading } = useAppContext();
  const journalsQuery = useJournals();
  const accountsQuery = useAccounts();
  const ecrituresQuery = useEcritures();
  const deleteEcriture = useDeleteEcriture();
  const validateEcriture = useValidateEcriture();
  const reverseEcriture = useReverseEcriture();

  const [journalId, setJournalId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionWarnings, setActionWarnings] = useState<string[] | null>(null);
  const [searchParams] = useSearchParams();
  const deepLinkedJournalId = searchParams.get('journal');
  const deepLinkedEcritureId = searchParams.get('ecriture');
  const hasOpenedDeepLink = useRef(false);

  const journals = journalsQuery.data ?? NO_JOURNALS;
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;
  const ecritures = ecrituresQuery.data ?? NO_ECRITURES;

  useEffect(() => {
    if (journalId) return;
    // The dashboard's recent-entries deep link supplies its journal
    // directly (DashboardRecentEntry.journalId) — selecting it doesn't
    // need to wait for the écritures list to load first. Falls back to
    // resolving it from the écriture itself if only `ecriture` is given.
    if (deepLinkedJournalId) {
      setJournalId(deepLinkedJournalId);
      return;
    }
    if (deepLinkedEcritureId) {
      const target = ecritures.find((e) => e.id === deepLinkedEcritureId);
      if (target) {
        setJournalId(target.journalId);
        return;
      }
    }
    if (journals.length > 0) setJournalId(journals[0].id);
  }, [journalId, journals, deepLinkedJournalId, deepLinkedEcritureId, ecritures]);

  // Closing over the editor when the global fiscal year changes avoids
  // leaving a "Nouvelle écriture" form open against a year that's no
  // longer the one shown in the topbar.
  useEffect(() => {
    setEditor({ mode: 'closed' });
  }, [fiscalYearId]);

  // Deep link from the dashboard's recent-entries row — opens the
  // editor on that exact écriture once it's loaded and its journal is
  // selected. `hasOpenedDeepLink` keeps this a one-time action so
  // closing the editor afterward (e.g. to validate a different entry)
  // never snaps back open.
  useEffect(() => {
    if (!deepLinkedEcritureId || hasOpenedDeepLink.current) return;
    const target = ecritures.find((e) => e.id === deepLinkedEcritureId);
    if (target && journalId === target.journalId) {
      setEditor({ mode: 'edit', ecriture: target });
      hasOpenedDeepLink.current = true;
    }
  }, [deepLinkedEcritureId, ecritures, journalId]);

  const scopedEcritures = useMemo(
    () =>
      ecritures
        .filter((e) => e.journalId === journalId && e.fiscalYearId === fiscalYearId)
        .sort((a, b) => b.ecritureDate.localeCompare(a.ecritureDate)),
    [ecritures, journalId, fiscalYearId],
  );

  // Draft counts per journal, for the tab bar badges below — a plain
  // client-side tally over the already-fetched écritures list, the same
  // "count what's already loaded" the drafts-block banners elsewhere in
  // this app already do (e.g. FecExportPage), never a new query.
  const draftCountByJournal = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of ecritures) {
      if (e.fiscalYearId === fiscalYearId && !e.validatedAt) {
        counts.set(e.journalId, (counts.get(e.journalId) ?? 0) + 1);
      }
    }
    return counts;
  }, [ecritures, fiscalYearId]);

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

  const isLoading = journalsQuery.isLoading || accountsQuery.isLoading || fiscalYearsLoading;

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-40 animate-pulse rounded-md bg-border" />
          <div className="h-3.5 w-72 animate-pulse rounded-md bg-border" />
        </div>
        <div className="h-9 w-full animate-pulse rounded-md bg-border" />
        <div className="h-64 w-full animate-pulse rounded-lg bg-border" />
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
        <button
          type="button"
          onClick={() => setEditor({ mode: 'new' })}
          disabled={!journalId || !fiscalYearId || Boolean(selectedFiscalYear?.closedAt)}
          className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
        >
          + Nouvelle écriture
        </button>
      </header>

      <JournalTabs
        journals={journals}
        selectedId={journalId}
        onSelect={setJournalId}
        draftCountByJournal={draftCountByJournal}
      />

      {selectedFiscalYear?.closedAt && (
        <Banner tone="warning">
          L'exercice « {selectedFiscalYear.label} » est clôturé — lecture seule.
        </Banner>
      )}

      {actionError && (
        <Banner tone="negative" onDismiss={() => setActionError(null)}>
          {actionError}
        </Banner>
      )}

      {actionSuccess && (
        <Banner tone="positive" onDismiss={() => setActionSuccess(null)}>
          {actionSuccess}
        </Banner>
      )}

      {actionWarnings && actionWarnings.length > 0 && (
        <Banner tone="warning" onDismiss={() => setActionWarnings(null)}>
          <div className="flex flex-col gap-1">
            {actionWarnings.map((warning, i) => (
              <span key={i}>{warning}</span>
            ))}
          </div>
        </Banner>
      )}

      {editor.mode !== 'closed' && journalId && fiscalYearId && (
        <EcritureEditor
          key={editor.mode === 'edit' ? editor.ecriture.id : 'new'}
          journalId={journalId}
          fiscalYearId={fiscalYearId}
          accounts={accounts}
          existing={editor.mode === 'edit' ? editor.ecriture : null}
          onSaved={(warnings) => {
            setEditor({ mode: 'closed' });
            setActionWarnings(warnings.length > 0 ? warnings : null);
          }}
          onCancel={() => setEditor({ mode: 'closed' })}
        />
      )}

      <EcrituresList
        ecritures={scopedEcritures}
        selectedId={editor.mode === 'edit' ? editor.ecriture.id : null}
        accounts={accounts}
        onSelect={(ecriture) => setEditor({ mode: 'edit', ecriture })}
        onDelete={handleDelete}
        onValidate={handleValidate}
        onReverse={handleReverse}
      />
    </div>
  );
}

/**
 * Journal tabs, not a dropdown — a bookkeeper switches journals many
 * times a day, and a tab a click away scans and selects faster than a
 * <select> that always needs two clicks. The draft-count badge means
 * "does AC need attention" is visible without opening it.
 */
function JournalTabs({
  journals,
  selectedId,
  onSelect,
  draftCountByJournal,
}: {
  journals: Journal[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  draftCountByJournal: Map<string, number>;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1.5 border-b border-border pb-3">
      {journals.map((journal) => {
        const isActive = journal.id === selectedId;
        const draftCount = draftCountByJournal.get(journal.id) ?? 0;
        return (
          <button
            key={journal.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(journal.id)}
            className={[
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-accent text-white shadow-card'
                : 'bg-bg text-ink-muted hover:bg-accent-soft hover:text-accent',
            ].join(' ')}
          >
            <span className="font-semibold">{journal.code}</span>
            <span className={isActive ? 'text-white/80' : 'text-ink-faint'}>{journal.label}</span>
            {draftCount > 0 && (
              <span
                className={[
                  'flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
                  isActive ? 'bg-white/25 text-white' : 'bg-warning-soft text-warning',
                ].join(' ')}
                title={`${draftCount} brouillon${draftCount > 1 ? 's' : ''}`}
              >
                {draftCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const BANNER_TONE: Record<'warning' | 'negative' | 'positive', { bg: string; text: string }> = {
  warning: { bg: 'bg-warning-soft', text: 'text-warning' },
  negative: { bg: 'bg-negative-soft', text: 'text-negative' },
  positive: { bg: 'bg-positive-soft', text: 'text-positive' },
};

/** One shared shape for the page's status banners — a tone-tinted icon
 * badge plus an optional dismiss action, instead of four near-duplicate
 * hand-styled blocks. */
function Banner({
  tone,
  onDismiss,
  children,
}: {
  tone: 'warning' | 'negative' | 'positive';
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const { bg, text } = BANNER_TONE[tone];
  return (
    <div className={['flex items-start gap-3 rounded-md px-4 py-3 text-[13px]', bg, text].join(' ')}>
      <BannerIcon tone={tone} />
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 font-medium opacity-70 hover:opacity-100"
          aria-label="Fermer"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

function BannerIcon({ tone }: { tone: 'warning' | 'negative' | 'positive' }) {
  if (tone === 'positive') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-0.5 shrink-0">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.2 8.2 7.2 10l3.6-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-0.5 shrink-0">
      <path
        d="M8 1.8 1.4 13.3h13.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6.2v3.4M8 11.6h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
