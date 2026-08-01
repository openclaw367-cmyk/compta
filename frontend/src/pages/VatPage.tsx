import { useState } from 'react';
import { useCreateVatRate, useVatRates } from '../api/queries';
import type { CreateVatRateDto } from '../api/dto';
import { ApiError } from '../api/client';
import { normalizeMoneyInput, sanitizeAmountBuffer } from '../lib/money';

const NO_RATES: never[] = [];
const TODAY = new Date().toISOString().slice(0, 10);

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatPercent(value: string): string {
  return `${value.replace('.', ',')} %`;
}

function emptyDraft(): { label: string; ratePercent: string; validFrom: string; validTo: string } {
  return { label: '', ratePercent: '', validFrom: '', validTo: '' };
}

type Status = 'upcoming' | 'active' | 'expired';

function statusOf(validFrom: string, validTo: string | null): Status {
  const from = validFrom.slice(0, 10);
  const to = validTo?.slice(0, 10);
  if (from > TODAY) return 'upcoming';
  if (to && to < TODAY) return 'expired';
  return 'active';
}

const STATUS_LABEL: Record<Status, string> = {
  upcoming: 'À venir',
  active: 'Actif',
  expired: 'Expiré',
};

const STATUS_CLASS: Record<Status, string> = {
  upcoming: 'bg-warning-soft text-warning',
  active: 'bg-positive-soft text-positive',
  expired: 'bg-bg text-ink-muted',
};

export function VatPage() {
  const vatRatesQuery = useVatRates();
  const createVatRate = useCreateVatRate();

  const rates = vatRatesQuery.data ?? NO_RATES;
  const sorted = [...rates].sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [createError, setCreateError] = useState<string[] | null>(null);

  const normalizedRate = normalizeMoneyInput(draft.ratePercent || '');
  const rateIsValid = /^\d+(\.\d{1,2})?$/.test(normalizedRate);
  const canCreate =
    draft.label.trim() !== '' &&
    rateIsValid &&
    draft.validFrom !== '' &&
    (draft.validTo === '' || draft.validTo >= draft.validFrom);

  async function handleCreate() {
    if (!canCreate) return;
    setCreateError(null);
    const dto: CreateVatRateDto = {
      label: draft.label.trim(),
      ratePercent: normalizedRate,
      validFrom: draft.validFrom,
      validTo: draft.validTo === '' ? undefined : draft.validTo,
    };
    try {
      await createVatRate.mutateAsync(dto);
      setDraft(emptyDraft());
      setIsCreating(false);
    } catch (error) {
      setCreateError(error instanceof ApiError ? error.details : ["La création a échoué."]);
    }
  }

  if (vatRatesQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">TVA</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Taux de TVA applicables, par période de validité.
        </p>
      </header>

      <div className="rounded-md bg-bg px-4 py-2.5 text-[13px] text-ink-muted">
        Le calcul de la déclaration de TVA (CA3) n'est pas encore implémenté côté serveur — voir
        CLAUDE.md. Cet écran ne gère que les taux, qui alimenteront ce calcul une fois disponible.
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-ink">Taux</h2>
          <button
            type="button"
            onClick={() => {
              setIsCreating(true);
              setCreateError(null);
            }}
            disabled={isCreating}
            className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            + Nouveau taux
          </button>
        </div>

        {isCreating && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Libellé">
                <input
                  autoFocus
                  type="text"
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="Taux normal"
                  className="w-40 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </Field>
              <Field label="Taux (%)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.ratePercent}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, ratePercent: sanitizeAmountBuffer(e.target.value) }))
                  }
                  placeholder="20,00"
                  className="w-24 rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </Field>
              <Field label="Valide à partir du">
                <input
                  type="date"
                  value={draft.validFrom}
                  onChange={(e) => setDraft((d) => ({ ...d, validFrom: e.target.value }))}
                  className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </Field>
              <Field label="Valide jusqu'au">
                <input
                  type="date"
                  value={draft.validTo}
                  onChange={(e) => setDraft((d) => ({ ...d, validTo: e.target.value }))}
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
                  disabled={!canCreate || createVatRate.isPending}
                  onClick={() => void handleCreate()}
                  className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
                >
                  {createVatRate.isPending ? 'Création…' : 'Créer'}
                </button>
              </div>
            </div>
            {draft.validTo !== '' && draft.validTo < draft.validFrom && (
              <p className="text-[12px] text-negative">
                La date de fin doit être postérieure ou égale à la date de début.
              </p>
            )}
            {createError && (
              <div className="text-[12.5px] text-negative">
                {createError.map((message, i) => (
                  <div key={i}>{message}</div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Libellé</th>
                <th className="px-4 py-2.5 text-right font-semibold">Taux</th>
                <th className="px-4 py-2.5 font-semibold">Valide à partir du</th>
                <th className="px-4 py-2.5 font-semibold">Valide jusqu'au</th>
                <th className="px-4 py-2.5 font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-ink-faint">
                    Aucun taux de TVA — créez-en un pour commencer.
                  </td>
                </tr>
              ) : (
                sorted.map((rate) => {
                  const status = statusOf(rate.validFrom, rate.validTo);
                  return (
                    <tr key={rate.id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{rate.label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                        {formatPercent(rate.ratePercent)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                        {formatDate(rate.validFrom)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                        {rate.validTo ? formatDate(rate.validTo) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={[
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium',
                            STATUS_CLASS[status],
                          ].join(' ')}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
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
