import { useState } from 'react';
import {
  useCloseFiscalYear,
  useCreateFiscalYear,
  useEcritures,
  useFiscalYearArchive,
  useFiscalYears,
  useGenerateANouveau,
  useJournals,
  useValidateFiscalYearDrafts,
} from '../api/queries';
import type { CreateFiscalYearDto } from '../api/dto';
import type { FiscalYear } from '../api/types';
import { ApiError } from '../api/client';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { useToast } from '../context/toastStore';

const NO_FISCAL_YEARS: never[] = [];
const NO_ECRITURES: never[] = [];

/**
 * Mirrors ANouveauService.findPriorFiscalYear on the backend: the fiscal
 * year with the latest endDate strictly before this one's startDate. Used
 * only to decide whether/how to show the "Générer l'à-nouveau" action —
 * the backend re-checks this itself at generation time regardless.
 */
function findPriorFiscalYear(fiscalYears: FiscalYear[], target: FiscalYear): FiscalYear | null {
  const candidates = fiscalYears.filter((fy) => fy.id !== target.id && fy.endDate < target.startDate);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, fy) => (fy.endDate > latest.endDate ? fy : latest));
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function emptyDraft(): CreateFiscalYearDto {
  return { label: '', startDate: '', endDate: '' };
}

export function FiscalYearsPage() {
  const fiscalYearsQuery = useFiscalYears();
  const journalsQuery = useJournals();
  const ecrituresQuery = useEcritures();
  const createFiscalYear = useCreateFiscalYear();
  const closeFiscalYear = useCloseFiscalYear();
  const generateANouveau = useGenerateANouveau();
  const validateDrafts = useValidateFiscalYearDrafts();
  const toast = useToast();

  const fiscalYears = fiscalYearsQuery.data ?? NO_FISCAL_YEARS;
  const sorted = [...fiscalYears].sort((a, b) => b.startDate.localeCompare(a.startDate));

  const anJournal = journalsQuery.data?.find((j) => j.type === 'A_NOUVEAU') ?? null;
  const ecritures = ecrituresQuery.data ?? NO_ECRITURES;
  const generatedFiscalYearIds = new Set(
    anJournal ? ecritures.filter((e) => e.journalId === anJournal.id).map((e) => e.fiscalYearId) : [],
  );
  // Computed from the same already-fetched écritures list used for the
  // à-nouveau check above — no new query needed just to show a count.
  const draftCountByFiscalYearId = new Map<string, number>();
  for (const e of ecritures) {
    if (e.validatedAt) continue;
    draftCountByFiscalYearId.set(e.fiscalYearId, (draftCountByFiscalYearId.get(e.fiscalYearId) ?? 0) + 1);
  }

  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<CreateFiscalYearDto>(emptyDraft());
  const [createError, setCreateError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);

  const canCreate =
    draft.label.trim() !== '' &&
    draft.startDate !== '' &&
    draft.endDate !== '' &&
    draft.endDate >= draft.startDate;

  async function handleCreate() {
    if (!canCreate) return;
    setCreateError(null);
    try {
      await createFiscalYear.mutateAsync({
        label: draft.label.trim(),
        startDate: draft.startDate,
        endDate: draft.endDate,
      });
      setDraft(emptyDraft());
      setIsCreating(false);
    } catch (error) {
      setCreateError(error instanceof ApiError ? error.message : "La création a échoué.");
    }
  }

  async function handleClose(id: string, label: string) {
    if (
      !window.confirm(
        `Clôturer l'exercice « ${label} » ? Une fois clôturé, aucune écriture ne pourra plus y ` +
          "être créée, modifiée ou validée. Cette action ne peut pas être annulée depuis " +
          'l’application.',
      )
    ) {
      return;
    }
    setCloseError(null);
    setClosingId(id);
    try {
      await closeFiscalYear.mutateAsync(id);
      toast.show('success', `Exercice « ${label} » clôturé.`);
    } catch (error) {
      setCloseError(error instanceof ApiError ? error.message : 'La clôture a échoué.');
    } finally {
      setClosingId(null);
    }
  }

  async function handleValidateDrafts(id: string, label: string, count: number) {
    if (
      !window.confirm(
        `Valider les ${count} écriture(s) brouillon de « ${label} » ? Chacune recevra un ` +
          "numéro définitif et deviendra immuable — à utiliser pour amener un import historique " +
          'à un état clôturable, pas comme une validation ligne par ligne habituelle.',
      )
    ) {
      return;
    }
    setValidateError(null);
    setValidatingId(id);
    try {
      const result = await validateDrafts.mutateAsync(id);
      if (result.failedCount === 0) {
        toast.show('success', `${result.validatedCount} écriture(s) validée(s) pour « ${label} ».`);
      } else {
        setValidateError(
          `${result.validatedCount} validée(s), ${result.failedCount} en échec pour « ${label} » : ` +
            result.results
              .filter((r) => r.status === 'FAILED')
              .map((r) => r.error)
              .join(' '),
        );
      }
    } catch (error) {
      setValidateError(error instanceof ApiError ? error.message : 'La validation a échoué.');
    } finally {
      setValidatingId(null);
    }
  }

  async function handleGenerate(fy: FiscalYear, prior: FiscalYear) {
    if (
      !window.confirm(
        `Générer l'à-nouveau de « ${fy.label} » à partir de la clôture de « ${prior.label} » ? ` +
          'Une écriture sera créée et validée immédiatement dans le journal AN : elle reprend, ' +
          `compte par compte (et tiers par tiers), les soldes de bilan (classes 1 à 5) de « ${prior.label} », ` +
          "et impute son résultat en 120/129, non affecté — l'affectation par l'assemblée " +
          "générale se fera plus tard via une écriture séparée. Cette écriture sera définitive : " +
          'une correction éventuelle passera par une contre-passation.',
      )
    ) {
      return;
    }
    setGenerateError(null);
    setGenerateSuccess(null);
    setGeneratingId(fy.id);
    try {
      const ecriture = await generateANouveau.mutateAsync(fy.id);
      setGenerateSuccess(
        `À-nouveau généré pour « ${fy.label} » (écriture n°${ecriture.ecritureNum ?? '?'}).`,
      );
    } catch (error) {
      setGenerateError(error instanceof ApiError ? error.message : "La génération a échoué.");
    } finally {
      setGeneratingId(null);
    }
  }

  if (fiscalYearsQuery.isLoading) {
    return <PageSkeleton maxWidth="max-w-3xl" blocks={2} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Exercices</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Exercices comptables de la société — création et clôture.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
            setCreateError(null);
          }}
          disabled={isCreating}
          className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
        >
          + Nouvel exercice
        </button>
      </header>

      {closeError && (
        <div className="flex items-center justify-between rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
          <span>{closeError}</span>
          <button type="button" onClick={() => setCloseError(null)} className="font-medium">
            Fermer
          </button>
        </div>
      )}

      {validateError && (
        <div className="flex items-center justify-between rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
          <span>{validateError}</span>
          <button type="button" onClick={() => setValidateError(null)} className="font-medium">
            Fermer
          </button>
        </div>
      )}

      {generateError && (
        <div className="flex items-center justify-between rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
          <span>{generateError}</span>
          <button type="button" onClick={() => setGenerateError(null)} className="font-medium">
            Fermer
          </button>
        </div>
      )}

      {generateSuccess && (
        <div className="flex items-center justify-between rounded-md bg-positive-soft px-4 py-2.5 text-[13px] text-positive">
          <span>{generateSuccess}</span>
          <button type="button" onClick={() => setGenerateSuccess(null)} className="font-medium">
            Fermer
          </button>
        </div>
      )}

      {isCreating && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Libellé">
              <input
                autoFocus
                type="text"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="2027"
                className="w-32 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <Field label="Date de début">
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
                className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
              />
            </Field>
            <Field label="Date de fin">
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
                className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
              />
            </Field>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setDraft(emptyDraft());
                  setCreateError(null);
                }}
                className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!canCreate || createFiscalYear.isPending}
                onClick={() => void handleCreate()}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
              >
                {createFiscalYear.isPending ? 'Création…' : 'Créer'}
              </button>
            </div>
          </div>
          {draft.startDate !== '' && draft.endDate !== '' && draft.endDate < draft.startDate && (
            <p className="text-[12px] text-negative">
              La date de fin doit être postérieure ou égale à la date de début.
            </p>
          )}
          {createError && <p className="text-[12.5px] text-negative">{createError}</p>}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Libellé</th>
              <th className="px-4 py-2.5 font-semibold">Début</th>
              <th className="px-4 py-2.5 font-semibold">Fin</th>
              <th className="px-4 py-2.5 font-semibold">Statut</th>
              <th className="px-4 py-2.5 font-semibold">À-nouveau</th>
              <th className="w-28 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-ink-faint">
                  Aucun exercice — créez-en un pour commencer à saisir des écritures.
                </td>
              </tr>
            ) : (
              sorted.map((fy) => {
                const prior = findPriorFiscalYear(fiscalYears, fy);
                const alreadyGenerated = generatedFiscalYearIds.has(fy.id);
                return (
                  <tr key={fy.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{fy.label}</td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                      {formatDate(fy.startDate)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                      {formatDate(fy.endDate)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusCell
                        fy={fy}
                        draftCount={draftCountByFiscalYearId.get(fy.id) ?? 0}
                        isValidating={validatingId === fy.id}
                        onValidateDrafts={() =>
                          void handleValidateDrafts(
                            fy.id,
                            fy.label,
                            draftCountByFiscalYearId.get(fy.id) ?? 0,
                          )
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      {alreadyGenerated ? (
                        <span className="inline-flex items-center rounded-full bg-bg px-2 py-0.5 text-[11.5px] font-medium text-ink-muted">
                          Généré
                        </span>
                      ) : fy.closedAt ? (
                        <span className="text-[12px] text-ink-faint">—</span>
                      ) : !prior ? (
                        <span className="text-[12px] text-ink-faint" title="Aucun exercice précédent.">
                          Premier exercice
                        </span>
                      ) : !prior.closedAt ? (
                        <span
                          className="text-[12px] text-ink-faint"
                          title={`L'exercice précédent (« ${prior.label} ») n'est pas clôturé.`}
                        >
                          Exercice précédent ouvert
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleGenerate(fy, prior)}
                          disabled={generatingId === fy.id}
                          className="rounded px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {generatingId === fy.id ? 'Génération…' : 'Générer'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!fy.closedAt && (
                        <button
                          type="button"
                          onClick={() => void handleClose(fy.id, fy.label)}
                          disabled={closingId === fy.id}
                          className="rounded px-2 py-1 text-[12px] font-medium text-ink-muted hover:bg-negative-soft hover:text-negative disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {closingId === fy.id ? 'Clôture…' : 'Clôturer'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Open/closed badge, plus:
 * - for an OPEN year with draft écritures, the bulk-validate action
 *   (see CLAUDE.md "Operational readiness — bulk-validate") — the
 *   real friction point for bringing a historical import to a
 *   clôturable state without validating hundreds of entries one at a
 *   time. Shown here, not as a separate screen, since this draft count
 *   is exactly what `close()` itself would otherwise refuse on.
 * - for a CLOSED year, the archival record `close()` itself generates
 *   (see CLAUDE.md "Operational readiness — clôture d'exercice
 *   archival"): the actual user-facing payoff of that feature, showing
 *   that a real, tamper-evident FEC snapshot exists. A short hash
 *   prefix, not the full 64 hex chars — enough to recognize at a
 *   glance, with the full hash in the title tooltip for anyone who
 *   needs to compare it exactly (e.g. against a fresh re-export, per
 *   that feature's own stated verification method).
 */
function StatusCell({
  fy,
  draftCount,
  isValidating,
  onValidateDrafts,
}: {
  fy: FiscalYear;
  draftCount: number;
  isValidating: boolean;
  onValidateDrafts: () => void;
}) {
  const archiveQuery = useFiscalYearArchive(fy.id, Boolean(fy.closedAt));
  const archive = archiveQuery.data;

  if (!fy.closedAt) {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center rounded-full bg-positive-soft px-2 py-0.5 text-[11.5px] font-medium text-positive">
          Ouvert
        </span>
        {draftCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-faint">
              {draftCount} brouillon{draftCount > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={onValidateDrafts}
              disabled={isValidating}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isValidating ? 'Validation…' : 'Valider tout'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex w-fit items-center rounded-full bg-bg px-2 py-0.5 text-[11.5px] font-medium text-ink-muted">
        Clôturé le {formatDate(fy.closedAt)}
      </span>
      {archive && (
        <span
          className="text-[11px] text-ink-faint"
          title={`Fichier archivé : ${archive.fileName}\nSHA-256 : ${archive.sha256Hash}`}
        >
          Archivé — SHA-256 : {archive.sha256Hash.slice(0, 12)}…
        </span>
      )}
    </div>
  );
}
