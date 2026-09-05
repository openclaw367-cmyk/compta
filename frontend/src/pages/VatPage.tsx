import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAccounts,
  useComputeVatDeclaration,
  useCreateVatRate,
  useDownloadVatDeclarationExcel,
  useDownloadVatDeclarationPdf,
  useEcritures,
  useTraceCa3Line,
  useVatRates,
} from '../api/queries';
import type { CreateVatRateDto } from '../api/dto';
import type { Ca3Declaration, Ca3RateLine, Ca3TraceColumn, FiscalYear } from '../api/types';
import { ApiError } from '../api/client';
import { formatMoneyFr, normalizeMoneyInput, sanitizeAmountBuffer } from '../lib/money';
import { useAppContext } from '../context/appContextStore';
import { useSectionTab } from '../lib/useSectionTab';
import { SectionTabs, type TabSection } from '../components/layout/SectionTabs';

const NO_RATES: never[] = [];
const NO_ECRITURES: never[] = [];
const TODAY = new Date().toISOString().slice(0, 10);

const VAT_TABS: TabSection[] = [
  { id: 'declaration', label: 'Déclaration CA3' },
  { id: 'taux', label: 'Taux de TVA' },
];

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatPercent(value: string): string {
  return `${value.replace('.', ',')} %`;
}

export function VatPage() {
  const [activeTab, setActiveTab] = useSectionTab(
    VAT_TABS.map((t) => t.id),
    'declaration',
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">TVA</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Déclaration CA3 et taux applicables.
        </p>
      </header>

      <SectionTabs sections={VAT_TABS} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === 'declaration' && <DeclarationSection />}
      {activeTab === 'taux' && <RatesSection />}
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
  const { fiscalYears, fiscalYearId, fiscalYearsLoading } = useAppContext();
  const ecrituresQuery = useEcritures();
  const accountsQuery = useAccounts();
  const computeDeclaration = useComputeVatDeclaration();
  const downloadPdf = useDownloadVatDeclarationPdf();
  const downloadExcel = useDownloadVatDeclarationExcel();

  const ecritures = ecrituresQuery.data ?? NO_ECRITURES;
  // Ligne 19/20 are each fed by exactly one hardcoded PCG account (see
  // ca3-declaration.ts's DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT/
  // DEDUCTIBLE_AUTRES_ACCOUNT) — a real, clean 1:1 mapping the app
  // already knows, so resolving the account's id client-side (from the
  // already-fetched accounts list) to deep-link into the grand livre is
  // pure navigation, not a new computation.
  const immobilisationsAccountId = accountsQuery.data?.find(
    (a) => a.number === '445662',
  )?.id;
  const autresAccountId = accountsQuery.data?.find((a) => a.number === '445660')?.id;

  const [mode, setMode] = useState<PeriodMode>('month');
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [computeError, setComputeError] = useState<string[] | null>(null);

  // Mirrors the old local select's onChange side effects — the global
  // fiscal-year selector has no such hook, so this effect replaces it.
  useEffect(() => {
    setPeriodKey(null);
    setComputeError(null);
  }, [fiscalYearId]);

  const fiscalYear = fiscalYears.find((fy) => fy.id === fiscalYearId) ?? null;
  const periods = useMemo(
    () => (fiscalYear ? generatePeriods(fiscalYear, mode) : []),
    [fiscalYear, mode],
  );

  // Defaults to whichever period contains today, not just the fiscal
  // year's first one — the period a bookkeeper wants to declare is
  // almost always "the one we're in," not January.
  useEffect(() => {
    if (periods.length > 0 && !periods.some((p) => p.key === periodKey)) {
      const current = periods.find((p) => p.periodStart <= TODAY && TODAY <= p.periodEnd);
      setPeriodKey((current ?? periods[0]).key);
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
  const isLoading = fiscalYearsLoading || ecrituresQuery.isLoading;

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
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Exercice">
              <span className="py-[7px] text-[13px] text-ink">
                {fiscalYears.find((fy) => fy.id === fiscalYearId)?.label ?? '—'}{' '}
                <span className="text-ink-faint">(en haut de l'écran)</span>
              </span>
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
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                disabled={!selectedPeriod || downloadPdf.isPending}
                onClick={() =>
                  selectedPeriod &&
                  void downloadPdf.mutate({
                    periodStart: selectedPeriod.periodStart,
                    periodEnd: selectedPeriod.periodEnd,
                  })
                }
                className="rounded-md border border-border px-3 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:text-ink-faint"
              >
                {downloadPdf.isPending ? 'Génération…' : 'Télécharger PDF'}
              </button>
              <button
                type="button"
                disabled={!selectedPeriod || downloadExcel.isPending}
                onClick={() =>
                  selectedPeriod &&
                  void downloadExcel.mutate({
                    periodStart: selectedPeriod.periodStart,
                    periodEnd: selectedPeriod.periodEnd,
                  })
                }
                className="rounded-md border border-border px-3 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:text-ink-faint"
              >
                {downloadExcel.isPending ? 'Génération…' : 'Télécharger Excel'}
              </button>
              <button
                type="button"
                disabled={!canCompute}
                onClick={() => void handleCompute()}
                className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
              >
                {computeDeclaration.isPending ? 'Calcul…' : 'Calculer'}
              </button>
            </div>
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

      {declaration && (
        <DeclarationResult
          declaration={declaration}
          immobilisationsAccountId={immobilisationsAccountId}
          autresAccountId={autresAccountId}
        />
      )}
    </section>
  );
}

/**
 * Traceability drill-down, Tier 3 — CA3 lignes 08/09/9B/T6. Each row
 * has two independently-clickable cells (baseHT/taxe), same
 * click-to-expand idiom as the liasse annexe tables. No "→ écritures"
 * hop — see ca3-line-trace.ts's own doc comment on the backend for why
 * a VAT declaration period can't cleanly reuse the fiscal-year-scoped
 * AccountLedgerDrilldown; the account-level détail below is the honest
 * bottom of this chain, stated in the UI rather than silently omitted.
 */
function Ca3CollecteeRow({
  line,
  periodStart,
  periodEnd,
}: {
  line: Ca3RateLine;
  periodStart: string;
  periodEnd: string;
}) {
  const [expanded, setExpanded] = useState<Ca3TraceColumn | null>(null);
  const toggle = (column: Ca3TraceColumn) => setExpanded((c) => (c === column ? null : column));
  return (
    <>
      <tr className="border-b border-border last:border-b-0">
        <td className="px-4 py-2.5 text-ink">
          <span className="mr-2 font-medium tabular-nums text-ink-faint">{line.ligne}</span>
          {line.label}
        </td>
        <td
          role="button"
          tabIndex={0}
          onClick={() => toggle('baseHT')}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle('baseHT')}
          className={[
            'cursor-pointer px-4 py-2.5 text-right tabular-nums',
            expanded === 'baseHT' ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:bg-bg',
          ].join(' ')}
        >
          <span className="mr-1 text-ink-faint">{expanded === 'baseHT' ? '▾' : '▸'}</span>
          {formatMoneyFr(line.baseHT)}
        </td>
        <td
          role="button"
          tabIndex={0}
          onClick={() => toggle('taxe')}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle('taxe')}
          className={[
            'cursor-pointer px-4 py-2.5 text-right tabular-nums',
            expanded === 'taxe' ? 'bg-accent-soft font-medium text-ink' : 'text-ink hover:bg-bg',
          ].join(' ')}
        >
          <span className="mr-1 text-ink-faint">{expanded === 'taxe' ? '▾' : '▸'}</span>
          {formatMoneyFr(line.taxe)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={3} className="p-0">
            <Ca3LineTraceDrilldown
              periodStart={periodStart}
              periodEnd={periodEnd}
              ligne={line.ligne}
              column={expanded}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function Ca3LineTraceDrilldown({
  periodStart,
  periodEnd,
  ligne,
  column,
}: {
  periodStart: string;
  periodEnd: string;
  ligne: string;
  column: Ca3TraceColumn;
}) {
  const query = useTraceCa3Line(periodStart, periodEnd, ligne, column);
  if (query.isPending) {
    return (
      <div className="border-t border-border bg-bg px-5 py-3 text-[12.5px] text-ink-faint">
        Chargement…
      </div>
    );
  }
  if (query.isError || !query.data) {
    const message =
      query.error instanceof ApiError
        ? query.error.details.join(' ')
        : "Cette cellule n'a pas pu être tracée.";
    return (
      <div className="border-t border-border bg-bg px-5 py-3 text-[12.5px] italic text-ink-faint">
        {message}
      </div>
    );
  }
  const { data } = query;
  return (
    <div className="border-t border-border bg-bg px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between text-[12.5px]">
        <span className="font-semibold text-ink">
          Comptes contribuant à la ligne{' '}
          <span className="tabular-nums text-ink-faint">{data.ligne}</span>
        </span>
        <span className="tabular-nums text-ink-muted">
          Total tracé : <span className="font-medium text-ink">{formatMoneyFr(data.columnValue)}</span>
        </span>
      </div>
      {data.accounts.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Aucun compte ne contribue à cette ligne.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.accounts.map((a) => (
            <div
              key={a.accountId}
              className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-[12.5px]"
            >
              <span className="tabular-nums text-ink-faint">{a.accountNumber}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{a.accountLabel}</span>
              <span className="tabular-nums font-medium text-ink">
                {formatMoneyFr(a.contribution)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11.5px] italic text-ink-faint">
        Détail au niveau du compte uniquement — une période de déclaration ne correspond pas
        toujours à un seul exercice fiscal, donc les écritures individuelles ne sont pas affichées
        ici.
      </p>
    </div>
  );
}

function DeclarationResult({
  declaration,
  immobilisationsAccountId,
  autresAccountId,
}: {
  declaration: Ca3Declaration;
  immobilisationsAccountId: string | undefined;
  autresAccountId: string | undefined;
}) {
  const navigate = useNavigate();
  const collectee = sortByFormOrder(declaration.collecteeByRate);
  const isCredit = declaration.ligne25 !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
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
              <Ca3CollecteeRow
                key={line.ligne}
                line={line}
                periodStart={declaration.periodStart}
                periodEnd={declaration.periodEnd}
              />
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

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold" colSpan={2}>
                TVA déductible
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              onClick={
                immobilisationsAccountId
                  ? () => navigate(`/grand-livre?compte=${immobilisationsAccountId}`)
                  : undefined
              }
              className={[
                'border-b border-border',
                immobilisationsAccountId ? 'cursor-pointer hover:bg-bg' : '',
              ].join(' ')}
              title={immobilisationsAccountId ? 'Voir le compte 445662 dans le grand livre' : undefined}
            >
              <td className="px-4 py-2.5 text-ink">
                <span className="mr-2 font-medium tabular-nums text-ink-faint">19</span>
                Biens constituant des immobilisations
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                {formatMoneyFr(declaration.ligne19)}
              </td>
            </tr>
            <tr
              onClick={
                autresAccountId ? () => navigate(`/grand-livre?compte=${autresAccountId}`) : undefined
              }
              className={[
                'border-b border-border',
                autresAccountId ? 'cursor-pointer hover:bg-bg' : '',
              ].join(' ')}
              title={autresAccountId ? 'Voir le compte 445660 dans le grand livre' : undefined}
            >
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
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-card">
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

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
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
