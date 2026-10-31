import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/appContextStore';
import { useCabinetSummaries } from '../api/queries';
import { ROLE_LABEL } from '../lib/membershipRoles';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { IconBuilding } from '../components/layout/icons';

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

  function openCompany(id: string) {
    setCompanyId(id);
    navigate('/tableau-de-bord');
  }

  if (companiesLoading) {
    return <PageSkeleton maxWidth="max-w-4xl" blocks={3} />;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Cabinet</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          {companies.length} société{companies.length > 1 ? 's' : ''} — cliquez sur une ligne pour
          l'ouvrir.
        </p>
      </header>

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

function CountPill({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: 'warning' | 'accent';
}) {
  const toneClass = tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent';
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium ${toneClass}`}>
      {count} {label}
    </span>
  );
}
