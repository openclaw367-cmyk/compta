import { useState } from 'react';
import { useCloseFiscalYear, useCreateFiscalYear, useFiscalYears } from '../api/queries';
import type { CreateFiscalYearDto } from '../api/dto';
import { ApiError } from '../api/client';

const NO_FISCAL_YEARS: never[] = [];

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function emptyDraft(): CreateFiscalYearDto {
  return { label: '', startDate: '', endDate: '' };
}

export function FiscalYearsPage() {
  const fiscalYearsQuery = useFiscalYears();
  const createFiscalYear = useCreateFiscalYear();
  const closeFiscalYear = useCloseFiscalYear();

  const fiscalYears = fiscalYearsQuery.data ?? NO_FISCAL_YEARS;
  const sorted = [...fiscalYears].sort((a, b) => b.startDate.localeCompare(a.startDate));

  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<CreateFiscalYearDto>(emptyDraft());
  const [createError, setCreateError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

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
    } catch (error) {
      setCloseError(error instanceof ApiError ? error.message : 'La clôture a échoué.');
    } finally {
      setClosingId(null);
    }
  }

  if (fiscalYearsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
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
              <th className="w-32 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-ink-faint">
                  Aucun exercice — créez-en un pour commencer à saisir des écritures.
                </td>
              </tr>
            ) : (
              sorted.map((fy) => (
                <tr key={fy.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{fy.label}</td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                    {formatDate(fy.startDate)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                    {formatDate(fy.endDate)}
                  </td>
                  <td className="px-4 py-2.5">
                    {fy.closedAt ? (
                      <span className="inline-flex items-center rounded-full bg-bg px-2 py-0.5 text-[11.5px] font-medium text-ink-muted">
                        Clôturé le {formatDate(fy.closedAt)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-positive-soft px-2 py-0.5 text-[11.5px] font-medium text-positive">
                        Ouvert
                      </span>
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
              ))
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
