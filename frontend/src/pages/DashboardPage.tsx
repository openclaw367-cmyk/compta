import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAnomaliesSummary, useCompany, useDashboardSummary } from '../api/queries';
import { useAppContext } from '../context/appContextStore';
import type {
  DashboardAssocieBalance,
  DashboardCaHistoryPoint,
  DashboardRecentEntry,
  DashboardSummaryAvailable,
} from '../api/types';
import { ApiError } from '../api/client';
import {
  compareMoneyStrings,
  formatMoneyFr,
  formatPercent,
  isNegativeMoney,
  isZeroMoney,
  moneyRatio,
  subtractMoneyStrings,
} from '../lib/money';
import { IconDocument, IconTrendUp, IconWallet } from '../components/layout/icons';
import { PaymentAnomalyRow, SpendingAnomalyRow } from '../components/anomalies/AnomalyRows';

type IconComponent = (props: { className?: string }) => ReactNode;

/**
 * The landing screen — see CLAUDE.md "Dashboard". Every figure rendered
 * here comes straight from `GET /dashboard/summary`
 * (`DashboardService.getSummary()`), which itself only composes
 * already-verified service methods (LiasseService, FinancialAnalysisService,
 * LedgerService). This page adds ZERO business logic of its own: no money
 * is added, subtracted, or re-derived here except the two purely
 * presentational uses documented at each call site (a chart's own delta
 * caption, computed with the same `subtractMoneyStrings` helper every
 * other page already uses for display).
 */
export function DashboardPage() {
  const { fiscalYearId } = useAppContext();
  const companyQuery = useCompany();
  const summaryQuery = useDashboardSummary(fiscalYearId);

  if (summaryQuery.isLoading) {
    return <DashboardSkeleton />;
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    const err = summaryQuery.error;
    return (
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-negative bg-negative-soft p-5 text-[13px] text-negative">
          <span>
            Impossible de charger le tableau de bord
            {err instanceof ApiError ? ` : ${err.details.join(' ')}` : '.'}
          </span>
          <button
            type="button"
            onClick={() => void summaryQuery.refetch()}
            className="shrink-0 rounded-md border border-negative px-3 py-1.5 text-[12.5px] font-medium text-negative transition-colors hover:bg-negative hover:text-white"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  const summary = summaryQuery.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">Tableau de bord</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          {companyQuery.data?.name ?? 'Votre dossier'}
          {summary.available ? ` — exercice ${summary.fiscalYear.label}` : ''}
        </p>
      </header>

      {fiscalYearId && <AnomaliesSection fiscalYearId={fiscalYearId} />}

      {!summary.available ? (
        <div className="rounded-lg border border-warning bg-warning-soft p-5 text-[13px] text-warning">
          <p>{summary.reason}</p>
          <Link
            to="/ecritures"
            className="mt-2 inline-block font-medium text-warning underline hover:no-underline"
          >
            Consulter les écritures →
          </Link>
        </div>
      ) : (
        <>
          <HeadlineRow summary={summary} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <CaHistoryChart points={summary.caHistory} />
            </div>
            <MargeEbeCard ebe={summary.ebe} margeEbe={summary.margeEbe} />
          </div>
          <RevenusDepensesChart
            revenus={summary.revenus}
            depenses={summary.depenses}
            resultatNet={summary.resultatNet}
          />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <RecentBankEntriesSection entries={summary.recentBankEntries} />
            <ComptesCourantsSection lines={summary.comptesCourantsAssocies} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton — mirrors the real layout's shape (headline row, chart
// + EBE, revenus/dépenses, two bottom cards) so the page doesn't jump
// around once data arrives, and reads as "working" rather than "stuck"
// on what's usually the very first thing a user sees each session.
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={['animate-pulse rounded-md bg-border', className].join(' ')} />;
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
      <header className="flex flex-col gap-2">
        <SkeletonBlock className="h-6 w-48" />
        <SkeletonBlock className="h-3.5 w-64" />
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="h-7 w-28" />
            <SkeletonBlock className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonBlock className="h-52 lg:col-span-2" />
        <SkeletonBlock className="h-52" />
      </div>
      <SkeletonBlock className="h-32" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-64" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Headline cards
// ---------------------------------------------------------------------------

function HeadlineRow({ summary }: { summary: DashboardSummaryAvailable }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <HeadlineCard
        label="Trésorerie"
        value={summary.tresorerie}
        caption="Disponibilités — bilan, ligne CF"
        negative={isNegativeMoney(summary.tresorerie)}
        to="/grand-livre"
        Icon={IconWallet}
        tone="accent"
      />
      <HeadlineCard
        label="Chiffre d'affaires"
        value={summary.chiffreAffaires}
        caption={`Exercice ${summary.fiscalYear.label}`}
        to="/liasse"
        Icon={IconTrendUp}
        tone="positive"
      />
      <HeadlineCard
        label="À payer"
        value={summary.dettesFournisseurs}
        caption="Dettes fournisseurs — bilan, ligne DX"
        to="/grand-livre"
        Icon={IconDocument}
        tone="warning"
      />
      <HeadlineCard
        label="Encours client"
        value={summary.encoursClient}
        caption="Créances clients, montant brut — 2057 Cadre A, ligne BX"
        to="/grand-livre"
        Icon={IconDocument}
        tone="accent"
      />
    </div>
  );
}

const TONE_BADGE: Record<'accent' | 'positive' | 'warning', string> = {
  accent: 'bg-accent-soft text-accent',
  positive: 'bg-positive-soft text-positive',
  warning: 'bg-warning-soft text-warning',
};

function HeadlineCard({
  label,
  value,
  caption,
  negative,
  to,
  Icon,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  negative?: boolean;
  to: string;
  Icon: IconComponent;
  tone: 'accent' | 'positive' | 'warning';
}) {
  return (
    <Link
      to={to}
      className="group block rounded-lg border border-border bg-surface p-5 shadow-card transition-colors hover:border-accent-soft hover:bg-accent-soft/30"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {label}
        </div>
        <div
          className={[
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-transform group-hover:scale-105',
            TONE_BADGE[tone],
          ].join(' ')}
        >
          <Icon className="h-[15px] w-[15px]" />
        </div>
      </div>
      <div
        className={[
          'mt-2 text-[26px] font-semibold tabular-nums',
          negative ? 'text-negative' : 'text-ink',
        ].join(' ')}
      >
        {formatMoneyFr(value)}
      </div>
      <div className="mt-1 text-[11.5px] text-ink-muted">{caption}</div>
    </Link>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chiffre d'affaires over time — a hand-rolled bar chart (no charting
// library in this app's dependency tree, matching the same "no library
// for a handful of glyphs" discipline the sidebar icons already
// established). Bar heights are computed with money.ts's moneyRatio() —
// a plain JS number, but a dimensionless UI ratio, never a monetary
// value in its own right (see that function's own doc comment for why
// this is the one deliberate exception to "no Number() on an amount").
// ---------------------------------------------------------------------------

const CHART_BAR_MAX_HEIGHT = 120;

function CaHistoryChart({ points }: { points: DashboardCaHistoryPoint[] }) {
  if (points.length === 0) {
    return (
      <Link
        to="/liasse"
        className="flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card transition-colors hover:border-accent-soft"
      >
        <SectionTitle
          title="Chiffre d'affaires"
          description="Évolution par exercice, du plus ancien au plus récent."
        />
        <div className="flex flex-1 items-center justify-center text-[12.5px] text-ink-faint">
          Aucun exercice n'a pu être calculé pour cette évolution.
        </div>
      </Link>
    );
  }

  const maxCa = points.reduce(
    (max, p) => (compareMoneyStrings(p.chiffreDAffaires, max) > 0 ? p.chiffreDAffaires : max),
    points[0].chiffreDAffaires,
  );
  const last = points[points.length - 1];
  const prior = points.length > 1 ? points[points.length - 2] : null;
  const delta = prior ? subtractMoneyStrings(last.chiffreDAffaires, prior.chiffreDAffaires) : null;
  const deltaNegative = delta !== null && isNegativeMoney(delta);

  return (
    <Link
      to="/liasse"
      className="flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card transition-colors hover:border-accent-soft"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          title="Chiffre d'affaires"
          description="Évolution par exercice, du plus ancien au plus récent."
        />
        {delta !== null && prior && (
          <div
            className={[
              'shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium tabular-nums',
              deltaNegative ? 'bg-negative-soft text-negative' : 'bg-positive-soft text-positive',
            ].join(' ')}
          >
            {deltaNegative ? '' : '+'}
            {formatMoneyFr(delta)} vs {prior.label}
          </div>
        )}
      </div>
      <div className="flex items-end justify-center gap-4 pt-2">
        {points.map((point, i) => {
          const isCurrent = i === points.length - 1;
          const heightPx = Math.max(
            moneyRatio(point.chiffreDAffaires, maxCa) * CHART_BAR_MAX_HEIGHT,
            4,
          );
          return (
            <div
              key={point.fiscalYearId}
              className="flex flex-col items-center justify-end gap-2"
              style={{ height: CHART_BAR_MAX_HEIGHT + 44 }}
            >
              <div
                className={['w-14 max-w-14 rounded-t-sm', isCurrent ? 'bg-accent' : 'bg-accent-soft'].join(
                  ' ',
                )}
                style={{ height: heightPx }}
                title={formatMoneyFr(point.chiffreDAffaires)}
              />
              <div className="text-[12px] font-semibold tabular-nums text-ink">
                {formatMoneyFr(point.chiffreDAffaires)}
              </div>
              <div className="text-[11px] text-ink-muted">{point.label}</div>
            </div>
          );
        })}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Marge / EBE highlight — the app's differentiator figure (see CLAUDE.md
// "Analyse financière"): the économic-reality number a compliance-only
// tool never surfaces. margeEbe is a percentage STRING, not money (see
// financial-analysis.ts's own percentOrNull), so parsing it for the bar
// width below is not a money-handling violation.
// ---------------------------------------------------------------------------

function MargeEbeCard({ ebe, margeEbe }: { ebe: string; margeEbe: string | null }) {
  const negative = isNegativeMoney(ebe);
  const widthPct = margeEbe === null ? 0 : Math.max(Math.min(Number(margeEbe), 100), 0);
  return (
    <Link
      to="/analyse-financiere"
      className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-card transition-colors hover:border-accent-soft"
    >
      <SectionTitle
        title="EBE"
        description="Excédent brut d'exploitation — la rentabilité opérationnelle, avant amortissements et éléments financiers/exceptionnels."
      />
      <div
        className={[
          'text-[26px] font-semibold tabular-nums',
          negative ? 'text-negative' : 'text-ink',
        ].join(' ')}
      >
        {formatMoneyFr(ebe)}
      </div>
      <div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-accent-soft">
          <div
            className={negative ? 'h-full bg-negative' : 'h-full bg-accent'}
            style={{ width: `${widthPct}%` }}
          />
        </div>
        <div className="mt-1.5 text-[11.5px] text-ink-muted">
          {formatPercent(margeEbe)} du chiffre d'affaires
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Revenus vs dépenses
// ---------------------------------------------------------------------------

function RevenusDepensesChart({
  revenus,
  depenses,
  resultatNet,
}: {
  revenus: string;
  depenses: string;
  resultatNet: string;
}) {
  const max = compareMoneyStrings(revenus, depenses) >= 0 ? revenus : depenses;
  const revenusHeight = Math.max(moneyRatio(revenus, max) * 96, 4);
  const depensesHeight = Math.max(moneyRatio(depenses, max) * 96, 4);
  const resultatNegative = isNegativeMoney(resultatNet);

  return (
    <Link
      to="/liasse"
      className="block rounded-lg border border-border bg-surface p-5 shadow-card transition-colors hover:border-accent-soft"
    >
      <SectionTitle
        title="Revenus et dépenses"
        description="Total des produits et des charges de l'exercice, tous types confondus (exploitation, financier, exceptionnel)."
      />
      <div className="mt-4 flex flex-wrap items-end gap-10">
        <div className="flex flex-col items-center justify-end gap-2" style={{ height: 96 + 44 }}>
          <div className="text-[13px] font-semibold tabular-nums text-ink">
            {formatMoneyFr(revenus)}
          </div>
          <div className="w-16 rounded-t-sm bg-accent" style={{ height: revenusHeight }} />
          <div className="text-[11px] text-ink-muted">Revenus</div>
        </div>
        <div className="flex flex-col items-center justify-end gap-2" style={{ height: 96 + 44 }}>
          <div className="text-[13px] font-semibold tabular-nums text-ink">
            {formatMoneyFr(depenses)}
          </div>
          <div className="w-16 rounded-t-sm bg-border-strong" style={{ height: depensesHeight }} />
          <div className="text-[11px] text-ink-muted">Dépenses</div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-0.5 self-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Résultat net
          </div>
          <div
            className={[
              'text-[19px] font-semibold tabular-nums',
              resultatNegative ? 'text-negative' : 'text-positive',
            ].join(' ')}
          >
            {formatMoneyFr(resultatNet)}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Anomalies — see CLAUDE.md "Anomaly surfacing". A SEPARATE, independently-
// loading query from useDashboardSummary() (its own useAnomaliesSummary()
// call) — a failure or slow load here must never block the rest of the
// dashboard, so this section renders nothing rather than an error banner
// on failure, same as it renders nothing while still loading.
// ---------------------------------------------------------------------------

function AnomaliesSection({ fiscalYearId }: { fiscalYearId: string }) {
  const anomaliesQuery = useAnomaliesSummary(fiscalYearId);

  if (anomaliesQuery.isLoading) {
    return <div className="h-20 w-full animate-pulse rounded-lg bg-border" />;
  }
  if (anomaliesQuery.isError || !anomaliesQuery.data) {
    return null;
  }

  const { spending, payments } = anomaliesQuery.data;
  const totalCount = spending.length + payments.length;
  const highPayments = payments.filter((p) => p.matchTier === 'HIGH');
  const otherPayments = payments
    .filter((p) => p.matchTier !== 'HIGH')
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
  const sortedSpending = [...spending].sort((a, b) => Number(b.multiplier) - Number(a.multiplier));

  type Item =
    | { kind: 'spending'; key: string; anomaly: (typeof spending)[number] }
    | { kind: 'payment'; key: string; anomaly: (typeof payments)[number] };
  const items: Item[] = [
    ...highPayments.map((a): Item => ({ kind: 'payment', key: a.invoiceId, anomaly: a })),
    ...sortedSpending.map((a): Item => ({ kind: 'spending', key: `${a.accountId}-${a.month}`, anomaly: a })),
    ...otherPayments.map((a): Item => ({ kind: 'payment', key: a.invoiceId, anomaly: a })),
  ].slice(0, 5);

  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle
          title="Anomalies"
          description="Signaux à surveiller — jamais bloquants, jamais appliqués automatiquement."
        />
        {totalCount > 0 && (
          <Link
            to="/anomalies"
            className="shrink-0 text-[12px] font-medium text-accent hover:text-accent-hover"
          >
            Tout voir ({totalCount}) →
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-ink-faint">
          Aucune anomalie détectée pour cet exercice.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {items.map((item) =>
            item.kind === 'spending' ? (
              <SpendingAnomalyRow key={`s-${item.key}`} anomaly={item.anomaly} />
            ) : (
              <PaymentAnomalyRow key={`p-${item.key}`} anomaly={item.anomaly} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent bank transactions — class-5 entries, already filtered/sorted
// server-side (LedgerService.recentEntriesForClass()).
// ---------------------------------------------------------------------------

function RecentBankEntriesSection({ entries }: { entries: DashboardRecentEntry[] }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <SectionTitle
        title="Mouvements de trésorerie récents"
        description="Dernières écritures sur les comptes de classe 5 (banque, caisse) — cliquez une ligne pour l'ouvrir dans le journal."
      />
      {entries.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-ink-faint">Aucun mouvement pour cet exercice.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 pr-3 font-semibold">Libellé</th>
                <th className="py-2 pr-3 font-semibold">Compte</th>
                <th className="py-2 pr-3 text-right font-semibold">Débit</th>
                <th className="py-2 pl-3 text-right font-semibold">Crédit</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.ecritureId + entry.accountNumber + entry.debit + entry.credit}
                  onClick={() =>
                    navigate(`/ecritures?journal=${entry.journalId}&ecriture=${entry.ecritureId}`)
                  }
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-bg"
                >
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-ink-muted">
                    {formatDateFr(entry.ecritureDate)}
                  </td>
                  <td className="max-w-0 w-full py-2 pr-3 text-ink">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate" title={entry.libelle}>
                        {entry.libelle}
                      </span>
                      {!entry.isValidated && (
                        <span className="shrink-0 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">
                          Brouillon
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-ink-muted">
                    {entry.accountNumber} — {entry.accountLabel}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums text-ink">
                    {entry.debit === '0.00' ? '' : formatMoneyFr(entry.debit)}
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap tabular-nums text-ink">
                    {entry.credit === '0.00' ? '' : formatMoneyFr(entry.credit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comptes courants d'associés — per-associé balances (see CLAUDE.md
// "Dashboard": 455 was widened to an auxiliary-bearing collectif, same
// pattern as 401/411, specifically so this tile could show real
// per-associé figures instead of one opaque flat total).
// ---------------------------------------------------------------------------

function ComptesCourantsSection({ lines }: { lines: DashboardAssocieBalance[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <SectionTitle
        title="Comptes courants d'associés"
        description="Solde de chaque associé — négatif si la société lui doit (avance en compte courant), positif s'il doit à la société."
      />
      {lines.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-ink-faint">
          Aucun mouvement sur le compte 455 pour cet exercice.{' '}
          <Link to="/tiers" className="text-accent hover:text-accent-hover">
            Créer un associé →
          </Link>
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {lines.map((line) => {
            const negative = isNegativeMoney(line.balance);
            return (
              <Link
                key={line.accountId}
                to={`/grand-livre?compte=${line.accountId}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:border-accent-soft hover:bg-accent-soft/30"
              >
                <div>
                  <div className="text-[13px] font-medium text-ink">
                    {line.isUnattributed ? 'Non ventilé' : line.accountLabel}
                  </div>
                  <div className="text-[11px] text-ink-faint">
                    {line.accountNumber}
                    {line.isUnattributed && ' — écritures non rattachées à un associé nommé'}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={[
                      'text-[14px] font-semibold tabular-nums',
                      negative ? 'text-negative' : 'text-ink',
                    ].join(' ')}
                  >
                    {formatMoneyFr(line.balance)}
                  </div>
                  <div className="text-[10.5px] text-ink-faint">
                    {isZeroMoney(line.balance)
                      ? 'solde nul'
                      : negative
                        ? 'dû par la société'
                        : "dû par l'associé"}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDateFr(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}
