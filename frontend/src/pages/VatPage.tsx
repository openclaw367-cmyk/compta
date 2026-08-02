import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  useComputeVatDeclaration,
  useCreateVatRate,
  useEcritures,
  useFiscalYears,
  useVatRates,
} from '../api/queries';
import type { CreateVatRateDto } from '../api/dto';
import type { Ca3Declaration, Ca3RateLine, FiscalYear } from '../api/types';
import { ApiError } from '../api/client';
import { formatMoneyFr, normalizeMoneyInput, sanitizeAmountBuffer } from '../lib/money';

const NO_RATES: never[] = [];
const NO_FISCAL_YEARS: never[] = [];
const NO_ECRITURES: never[] = [];
const TODAY = new Date().toISOString().slice(0, 10);

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatPercent(value: string): string {
  return `${value.replace('.', ',')} %`;
}

export function VatPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">TVA</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Déclaration CA3 et taux applicables.
        </p>
      </header>

      <DeclarationSection />
      <RatesSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Déclaration CA3 — read-only report: computes and displays, never writes to
// the ledger. See VatService.computeDeclaration on the backend.
// ---------------------------------------------------------------------------

type PeriodMode = 'month' | 'quarter';

interface Period {
  /** The period's start date, also used as its React key. */
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
}

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/** The four implemented CA3 rate lines, in the real form's printed order (08, 09, 9B, T6). */
const RATE_LIGNE_ORDER = ['08', '09', '9B', 'T6'];

function addMonths(isoDate: string, months: number): string {
  const [y, m, day] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, day)).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, day] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + days)).toISOString().slice(0, 10);
}

function formatPeriodLabel(periodStart: string, mode: PeriodMode): string {
  const [y, m] = periodStart.slice(0, 10).split('-').map(Number);
  if (mode === 'month') return `${MONTH_NAMES[m - 1]} ${y}`;
  return `T${Math.ceil(m / 3)} ${y}`;
}

/**
 * Splits a fiscal year into calendar months or quarters, clipped to the
 * fiscal year's own bounds — a period picker, not a ledger computation, so
 * this is deliberately simple string/date-only arithmetic (no Decimal
 * involved) and assumes the fiscal year starts on the 1st of a month, true
 * for every fiscal year this app can create today.
 */
function generatePeriods(fiscalYear: FiscalYear, mode: PeriodMode): Period[] {
  const step = mode === 'month' ? 1 : 3;
  const fyEnd = fiscalYear.endDate.slice(0, 10);
  const periods: Period[] = [];
  let cursor = fiscalYear.startDate.slice(0, 10);
  while (cursor <= fyEnd) {
    const next = addMonths(cursor, step);
    const periodEnd = addDays(next, -1) < fyEnd ? addDays(next, -1) : fyEnd;
    periods.push({
      key: cursor,
      label: formatPeriodLabel(cursor, mode),
      periodStart: cursor,
      periodEnd,
    });
    cursor = next;
  }
  return periods;
}

function sortByFormOrder(lines: Ca3RateLine[]): Ca3RateLine[] {
  return [...lines].sort(
    (a, b) => RATE_LIGNE_ORDER.indexOf(a.ligne) - RATE_LIGNE_ORDER.indexOf(b.ligne),
  );
}

function DeclarationSection() {
  const fiscalYearsQuery = useFiscalYears();
  const ecrituresQuery = useEcritures();
  const computeDeclaration = useComputeVatDeclaration();

  const fiscalYears = fiscalYearsQuery.data ?? NO_FISCAL_YEARS;
  const ecritures = ecrituresQuery.data ?? NO_ECRITURES;

  const [fiscalYearId, setFiscalYearId] = useState<string | null>(null);
  const [mode, setMode] = useState<PeriodMode>('month');
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [computeError, setComputeError] = useState<string[] | null>(null);

  useEffect(() => {
    if (!fiscalYearId && fiscalYears.length > 0) setFiscalYearId(fiscalYears[0].id);
  }, [fiscalYearId, fiscalYears]);

  const fiscalYear = fiscalYears.find((fy) => fy.id === fiscalYearId) ?? null;
  const periods = useMemo(
    () => (fiscalYear ? generatePeriods(fiscalYear, mode) : []),
    [fiscalYear, mode],
  );

  useEffect(() => {
    if (periods.length > 0 && !periods.some((p) => p.key === periodKey)) {
      setPeriodKey(periods[0].key);
    }
  }, [periods, periodKey]);

  const selectedPeriod = periods.find((p) => p.key === periodKey) ?? null;

  // Mirrors FecExportPage: block Generate/Calculer client-side, naming the
  // count, rather than letting the button fail with a server error — the
  // backend refuses the whole computation (never a partial one) while any
  // draft exists in the period.
  const draftsInPeriod = useMemo(() => {
    if (!selectedPeriod) return [];
    return ecritures.filter(
      (e) =>
        e.validatedAt === null &&
        e.ecritureDate.slice(0, 10) >= selectedPeriod.periodStart &&
        e.ecritureDate.slice(0, 10) <= selectedPeriod.periodEnd,
    );
  }, [ecritures, selectedPeriod]);

  const canCompute =
    Boolean(selectedPeriod) && draftsInPeriod.length === 0 && !computeDeclaration.isPending;

  async function handleCompute() {
    if (!selectedPeriod) return;
    setComputeError(null);
    try {
      await computeDeclaration.mutateAsync({
        periodStart: selectedPeriod.periodStart,
        periodEnd: selectedPeriod.periodEnd,
      });
    } catch (error) {
      setComputeError(error instanceof ApiError ? error.details : ['Le calcul a échoué.']);
    }
  }

  const declaration: Ca3Declaration | null = computeDeclaration.data ?? null;
  const isLoading = fiscalYearsQuery.isLoading || ecrituresQuery.isLoading;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[14px] font-semibold text-ink">Déclaration CA3</h2>
      <p className="-mt-2 text-[12.5px] text-ink-muted">
        Régime du réel normal, cas de base uniquement — calcule et affiche, n'écrit jamais dans le
        journal.
      </p>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Chargement…
        </div>
      ) : fiscalYears.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Aucun exercice — créez-en un dans « Exercices » pour calculer une déclaration.
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Exercice">
              <select
                value={fiscalYearId ?? ''}
                onChange={(e) => {
                  setFiscalYearId(e.target.value);
                  setPeriodKey(null);
                  setComputeError(null);
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
            <Field label="Périodicité">
              <select
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as PeriodMode);
                  setPeriodKey(null);
                  setComputeError(null);
                }}
                className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
              >
                <option value="month">Mensuelle</option>
                <option value="quarter">Trimestrielle</option>
              </select>
            </Field>
            <Field label="Période">
              <select
                value={periodKey ?? ''}
                onChange={(e) => {
                  setPeriodKey(e.target.value);
                  setComputeError(null);
                }}
                className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
              >
                {periods.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              disabled={!canCompute}
              onClick={() => void handleCompute()}
              className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {computeDeclaration.isPending ? 'Calcul…' : 'Calculer'}
            </button>
          </div>

          {selectedPeriod && (
            <p className="text-[12px] text-ink-faint">
              Du {formatDate(selectedPeriod.periodStart)} au {formatDate(selectedPeriod.periodEnd)}
            </p>
          )}

          {draftsInPeriod.length > 0 && (
            <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
              {draftsInPeriod.length === 1
                ? "1 écriture en brouillon bloque le calcul : une écriture non validée dans la " +
                  "période empêche toute la déclaration, elle ne saute jamais silencieusement " +
                  'les brouillons. Validez-la ou supprimez-la pour continuer.'
                : `${draftsInPeriod.length} écritures en brouillon bloquent le calcul : une ` +
                  "écriture non validée dans la période empêche toute la déclaration, elle ne " +
                  'saute jamais silencieusement les brouillons. Validez-les ou supprimez-les ' +
                  'pour continuer.'}
            </div>
          )}

          {computeError && (
            <div className="rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
              {computeError.map((message, i) => (
                <div key={i}>{message}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {declaration && <DeclarationResult declaration={declaration} />}
    </section>
  );
}

function DeclarationResult({ declaration }: { declaration: Ca3Declaration }) {
  const collectee = sortByFormOrder(declaration.collecteeByRate);
  const isCredit = declaration.ligne25 !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">TVA brute (collectée)</th>
              <th className="px-4 py-2.5 text-right font-semibold">Base hors taxe</th>
              <th className="px-4 py-2.5 text-right font-semibold">Taxe due</th>
            </tr>
          </thead>
          <tbody>
            {collectee.map((line) => (
              <tr key={line.ligne} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2.5 text-ink">
                  <span className="mr-2 font-medium tabular-nums text-ink-faint">{line.ligne}</span>
                  {line.label}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                  {formatMoneyFr(line.baseHT)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                  {formatMoneyFr(line.taxe)}
                </td>
              </tr>
            ))}
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">
                <span className="mr-2 font-medium tabular-nums text-ink-faint">16</span>
                Total de la TVA brute due
              </td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(declaration.ligne16)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold" colSpan={2}>
                TVA déductible
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-4 py-2.5 text-ink">
                <span className="mr-2 font-medium tabular-nums text-ink-faint">19</span>
                Biens constituant des immobilisations
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                {formatMoneyFr(declaration.ligne19)}
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-2.5 text-ink">
                <span className="mr-2 font-medium tabular-nums text-ink-faint">20</span>
                Autres biens et services
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                {formatMoneyFr(declaration.ligne20)}
              </td>
            </tr>
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">
                <span className="mr-2 font-medium tabular-nums text-ink-faint">23</span>
                Total TVA déductible
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(declaration.ligne23)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        className={[
          'flex items-center justify-between rounded-lg border p-5',
          isCredit ? 'border-positive-soft bg-positive-soft' : 'border-accent-soft bg-accent-soft',
        ].join(' ')}
      >
        <div>
          <div
            className={[
              'text-[11px] font-semibold uppercase tracking-wide',
              isCredit ? 'text-positive' : 'text-accent',
            ].join(' ')}
          >
            {isCredit ? 'Ligne 25 — Crédit de TVA' : 'Ligne TD — TVA due'}
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {isCredit
              ? 'La TVA déductible dépasse la TVA collectée : ce crédit est à reporter sur la prochaine déclaration.'
              : 'La TVA collectée dépasse la TVA déductible : ce montant est à verser au Trésor.'}
          </p>
        </div>
        <div
          className={[
            'text-[22px] font-semibold tabular-nums',
            isCredit ? 'text-positive' : 'text-accent',
          ].join(' ')}
        >
          {formatMoneyFr(isCredit ? declaration.ligne25! : declaration.ligneTD!)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taux — VatRate CRUD, unchanged from the previous version of this page.
// ---------------------------------------------------------------------------

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

function emptyDraft(): { label: string; ratePercent: string; validFrom: string; validTo: string } {
  return { label: '', ratePercent: '', validFrom: '', validTo: '' };
}

function RatesSection() {
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
      <div className="flex items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink">Taux</h2>
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
