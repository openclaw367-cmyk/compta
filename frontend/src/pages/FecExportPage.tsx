import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  useDownloadFec,
  useDownloadFecDescription,
  useEcritures,
  useFiscalYears,
  useJournals,
} from '../api/queries';
import { ApiError } from '../api/client';
import { downloadTextFile } from '../lib/download';

const NO_FISCAL_YEARS: never[] = [];
const NO_JOURNALS: never[] = [];
const NO_ECRITURES: never[] = [];

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function FecExportPage() {
  const fiscalYearsQuery = useFiscalYears();
  const journalsQuery = useJournals();
  const ecrituresQuery = useEcritures();
  const fiscalYears = fiscalYearsQuery.data ?? NO_FISCAL_YEARS;
  const journals = journalsQuery.data ?? NO_JOURNALS;
  const ecritures = ecrituresQuery.data ?? NO_ECRITURES;

  const downloadFec = useDownloadFec();
  const downloadDescription = useDownloadFecDescription();

  const [fiscalYearId, setFiscalYearId] = useState<string | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);

  useEffect(() => {
    if (!fiscalYearId && fiscalYears.length > 0) setFiscalYearId(fiscalYears[0].id);
  }, [fiscalYearId, fiscalYears]);

  const scoped = useMemo(
    () => ecritures.filter((e) => e.fiscalYearId === fiscalYearId),
    [ecritures, fiscalYearId],
  );
  const validated = useMemo(() => scoped.filter((e) => e.validatedAt !== null), [scoped]);
  const drafts = useMemo(() => scoped.filter((e) => e.validatedAt === null), [scoped]);

  const journalCodesCovered = useMemo(() => {
    const journalById = new Map(journals.map((j) => [j.id, j.code]));
    const codes = new Set(
      validated.map((e) => journalById.get(e.journalId)).filter((code): code is string =>
        Boolean(code),
      ),
    );
    return Array.from(codes).sort();
  }, [validated, journals]);

  const dateRange = useMemo(() => {
    if (validated.length === 0) return null;
    const dates = validated.map((e) => e.ecritureDate.slice(0, 10)).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [validated]);

  async function handleDownloadFec() {
    if (!fiscalYearId) return;
    setError(null);
    setDownloaded(null);
    try {
      const file = await downloadFec.mutateAsync(fiscalYearId);
      downloadTextFile(file.filename, file.content);
      setDownloaded(file.filename);
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ["L'export a échoué."]);
    }
  }

  async function handleDownloadDescription() {
    if (!fiscalYearId) return;
    setError(null);
    try {
      const file = await downloadDescription.mutateAsync(fiscalYearId);
      downloadTextFile(file.filename, file.content);
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['Le téléchargement a échoué.']);
    }
  }

  const isLoading =
    fiscalYearsQuery.isLoading || journalsQuery.isLoading || ecrituresQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  // The backend refuses the whole export — never a partial one — while
  // any draft exists in the fiscal year (Article A47 A-1: an export must
  // never silently skip unvalidated entries). Blocking Generate here
  // mirrors that instead of letting the button fail with a server error.
  const canGenerate =
    Boolean(fiscalYearId) && validated.length > 0 && drafts.length === 0 && !downloadFec.isPending;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Export FEC</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Fichier des écritures comptables (Article A47 A-1 du LPF) — seules les écritures
          validées sont exportées.
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <Field label="Exercice">
          <select
            value={fiscalYearId ?? ''}
            onChange={(e) => {
              setFiscalYearId(e.target.value);
              setDownloaded(null);
              setError(null);
            }}
            className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
          >
            {fiscalYears.map((fy) => (
              <option key={fy.id} value={fy.id}>
                {fy.label}
              </option>
            ))}
          </select>
        </Field>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
          <SummaryItem label="Écritures exportées">
            <span className="tabular-nums font-semibold text-ink">{validated.length}</span>
          </SummaryItem>
          <SummaryItem label="Journaux couverts">
            {journalCodesCovered.length > 0 ? journalCodesCovered.join(', ') : '—'}
          </SummaryItem>
          <SummaryItem label="Période">
            {dateRange ? `${formatDate(dateRange.start)} – ${formatDate(dateRange.end)}` : '—'}
          </SummaryItem>
        </dl>

        {drafts.length > 0 && (
          <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
            {drafts.length === 1
              ? "1 écriture en brouillon bloque l'export : une écriture non validée empêche " +
                "tout l'export FEC, il ne saute jamais silencieusement les brouillons. " +
                'Validez-la ou supprimez-la pour continuer.'
              : `${drafts.length} écritures en brouillon bloquent l'export : une écriture non ` +
                "validée empêche tout l'export FEC, il ne saute jamais silencieusement les " +
                'brouillons. Validez-les ou supprimez-les pour continuer.'}
          </div>
        )}

        {validated.length === 0 && (
          <div className="rounded-md bg-bg px-4 py-2.5 text-[13px] text-ink-muted">
            Aucune écriture validée pour cet exercice — rien à exporter.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleDownloadFec()}
            disabled={!canGenerate}
            className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            {downloadFec.isPending ? 'Génération…' : 'Générer et télécharger'}
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadDescription()}
            disabled={!fiscalYearId || downloadDescription.isPending}
            className="rounded-md px-3 py-2 text-[13px] font-medium text-ink-muted hover:bg-bg disabled:cursor-not-allowed disabled:text-ink-faint"
          >
            {downloadDescription.isPending ? 'Téléchargement…' : 'Télécharger le descriptif'}
          </button>
        </div>
      </div>

      {downloaded && (
        <div className="rounded-md bg-positive-soft px-4 py-2.5 text-[13px] text-positive">
          Fichier téléchargé : {downloaded}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
          {error.map((message, index) => (
            <div key={index}>{message}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
