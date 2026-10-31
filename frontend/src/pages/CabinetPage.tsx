import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/appContextStore';
import { useCabinetSummaries, useExportFecForClosingCompanies } from '../api/queries';
import { ApiError } from '../api/client';
import type { CabinetBatchResponse } from '../api/types';
import { ROLE_LABEL } from '../lib/membershipRoles';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { IconBuilding, IconDownload } from '../components/layout/icons';

/** "2026-10" for the current calendar month — used as the default `month` for the batch FEC export below. */
function currentMonthParam(): string {
  return new Date().toISOString().slice(0, 7);
}

/** "octobre 2026" from a "2026-10" param — for the result panel's own header. */
function formatMonthLabel(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNum - 1, 1)).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Cross-company landing view — see CLAUDE.md "Multi-client / cabinet
 * management". One row per company the caller has a `Membership` in
 * (`useAppContext().companies`, already membership-scoped), each
 * showing the SAME signals `NeedsAttentionPanel` already computes for
 * the CURRENT company — draft count, anomaly count, pending invites —
 * via `useCabinetSummaries()`'s own per-company fan-out. Pure read-side
 * aggregation of already-correct per-company data: no new backend
 * endpoint, no new accounting oracle. Reachable only when a second
 * company exists (the "Cabinet" link in TopBar is gated the same way)
 * — with exactly one company this view would just restate the
 * dashboard.
 */
export function CabinetPage() {
  const { companies, companyId, setCompanyId, companiesLoading } = useAppContext();
  const navigate = useNavigate();
  const summaries = useCabinetSummaries(companies);
  const exportFecClosing = useExportFecForClosingCompanies();
  const [batchResult, setBatchResult] = useState<CabinetBatchResponse | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchMonth, setBatchMonth] = useState<string | null>(null);

  function openCompany(id: string) {
    setCompanyId(id);
    navigate('/tableau-de-bord');
  }

  async function handleExportFecClosing() {
    const month = currentMonthParam();
    setBatchError(null);
    setBatchResult(null);
    setBatchMonth(month);
    try {
      const result = await exportFecClosing.mutateAsync(month);
      setBatchResult(result);
    } catch (err) {
      setBatchError(err instanceof ApiError ? err.message : "L'export groupé a échoué.");
    }
  }

  if (companiesLoading) {
    return <PageSkeleton maxWidth="max-w-4xl" blocks={3} />;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Cabinet</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {companies.length} société{companies.length > 1 ? 's' : ''} — cliquez sur une ligne
            pour l'ouvrir.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleExportFecClosing()}
          disabled={exportFecClosing.isPending}
          className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-3.5 py-2 text-[12.5px] font-medium text-ink hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <IconDownload width={13} height={13} />
          {exportFecClosing.isPending ? 'Export en cours…' : 'Exporter FEC — clôtures de ce mois'}
        </button>
      </header>

      {(batchResult || batchError) && batchMonth && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-[13.5px] font-semibold text-ink">
              Export FEC — clôtures de {formatMonthLabel(batchMonth)}
            </h2>
            <button
              type="button"
              onClick={() => {
                setBatchResult(null);
                setBatchError(null);
              }}
              className="text-[12px] text-ink-faint hover:text-ink"
            >
              Masquer
            </button>
          </div>

          {batchError && <p className="text-[12.5px] text-negative">{batchError}</p>}

          {batchResult && batchResult.results.length === 0 && (
            <p className="text-[12.5px] text-ink-muted">
              Aucune société n'a d'exercice ouvert clôturant ce mois-ci.
            </p>
          )}

          {batchResult && batchResult.results.length > 0 && (
            <>
              <p className="text-[12px] text-ink-faint">
                {batchResult.succeededCount} réussi{batchResult.succeededCount > 1 ? 's' : ''}
                {batchResult.failedCount > 0
                  ? ` · ${batchResult.failedCount} échoué${batchResult.failedCount > 1 ? 's' : ''}`
                  : ''}
              </p>
              <div className="flex flex-col gap-1.5">
                {batchResult.results.map((item) => (
                  <div
                    key={`${item.companyId}-${item.fiscalYearId}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-bg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="truncate text-[12.5px] font-medium text-ink">
                        {item.companyName}
                      </span>
                      <span className="ml-1.5 text-[11.5px] text-ink-faint">
                        Exercice {item.fiscalYearLabel}
                      </span>
                      {item.status === 'FAILED' && item.error && (
                        <p className="mt-0.5 text-[11.5px] text-negative">{item.error}</p>
                      )}
                      {item.status === 'SUCCEEDED' && item.fileName && (
                        <p className="mt-0.5 text-[11.5px] text-ink-faint">{item.fileName}</p>
                      )}
                    </div>
                    <CountPill
                      count={0}
                      label={item.status === 'SUCCEEDED' ? 'Réussi' : 'Échoué'}
                      tone={item.status === 'SUCCEEDED' ? 'positive' : 'negative'}
                      hideCount
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {companies.map((company, index) => {
          const summaryQuery = summaries[index];
          const summary = summaryQuery?.data;
          const isCurrent = company.id === companyId;
          const isClean = summary
            ? summary.draftCount === 0 && summary.anomalyCount === 0 && summary.pendingInviteCount === 0
            : false;

          return (
            <button
              key={company.id}
              type="button"
              onClick={() => openCompany(company.id)}
              className={[
                'flex items-center justify-between gap-4 rounded-lg border bg-surface px-5 py-4 text-left shadow-card transition-colors',
                isCurrent ? 'border-accent' : 'border-border hover:border-accent/60',
              ].join(' ')}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <IconBuilding width={16} height={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-ink">{company.name}</span>
                    {isCurrent && (
                      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-accent">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-ink-faint">
                    {company.jurisdiction} · {company.role ? ROLE_LABEL[company.role] : '—'}
                    {summary?.fiscalYearLabel
                      ? ` · Exercice ${summary.fiscalYearLabel}`
                      : summary
                        ? ' · Aucun exercice'
                        : ''}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {summaryQuery?.isLoading ? (
                  <span className="h-5 w-24 animate-pulse rounded-full bg-border" />
                ) : summaryQuery?.isError ? (
                  <span className="text-[11.5px] text-ink-faint">Indisponible</span>
                ) : summary ? (
                  <>
                    {summary.draftCount > 0 && (
                      <CountPill
                        count={summary.draftCount}
                        label={summary.draftCount === 1 ? 'brouillon' : 'brouillons'}
                        tone="warning"
                      />
                    )}
                    {summary.anomalyCount > 0 && (
                      <CountPill
                        count={summary.anomalyCount}
                        label={summary.anomalyCount === 1 ? 'anomalie' : 'anomalies'}
                        tone="warning"
                      />
                    )}
                    {summary.pendingInviteCount > 0 && (
                      <CountPill
                        count={summary.pendingInviteCount}
                        label={summary.pendingInviteCount === 1 ? 'invitation' : 'invitations'}
                        tone="accent"
                      />
                    )}
                    {isClean && <span className="text-[11.5px] text-positive">À jour</span>}
                  </>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const COUNT_PILL_TONE_CLASS: Record<'warning' | 'accent' | 'positive' | 'negative', string> = {
  warning: 'bg-warning-soft text-warning',
  accent: 'bg-accent-soft text-accent',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
};

function CountPill({
  count,
  label,
  tone,
  hideCount = false,
}: {
  count: number;
  label: string;
  tone: 'warning' | 'accent' | 'positive' | 'negative';
  /** For a status pill (e.g. "Réussi"/"Échoué") where the count itself isn't meaningful. */
  hideCount?: boolean;
}) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium ${COUNT_PILL_TONE_CLASS[tone]}`}
    >
      {hideCount ? label : `${count} ${label}`}
    </span>
  );
}
