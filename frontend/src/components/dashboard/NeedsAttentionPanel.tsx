import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAnomaliesSummary, useEcritures, useMemberships } from '../../api/queries';
import { useAppContext } from '../../context/appContextStore';
import type { PaymentAnomaly, SpendingAnomaly } from '../../api/types';
import { PaymentAnomalyRow, SpendingAnomalyRow } from '../anomalies/AnomalyRows';
import { IconAlertTriangle } from '../layout/icons';

const MAX_ITEMS = 6;

/**
 * A single "what needs a look today" card, replacing the dashboard's
 * former anomalies-only tile. Every underlying figure was already
 * computed elsewhere in this app — this component adds no aggregation
 * of its own beyond ordering and capping a merged list:
 *  - draft écritures for the current fiscal year (the same
 *    `validatedAt === null` filter FecExportPage/LiassePage/VatPage
 *    already use to block generation — surfaced here BEFORE a user
 *    hits that wall on a report screen);
 *  - pending team invites (useMemberships(), shown only to an OWNER —
 *    a MEMBER/READ_ONLY can't act on an invite anyway);
 *  - the existing anomalies feed (useAnomaliesSummary(), unchanged).
 * Drafts and invites are operational/actionable ("something needs
 * doing"), so they sort ahead of anomalies ("something looks off, go
 * take a look") — highest-leverage item first.
 */
export function NeedsAttentionPanel() {
  const { fiscalYearId, currentCompany } = useAppContext();
  const ecrituresQuery = useEcritures();
  const membershipsQuery = useMemberships();
  const anomaliesQuery = useAnomaliesSummary(fiscalYearId);

  const draftCount = useMemo(() => {
    if (!fiscalYearId || !ecrituresQuery.data) return 0;
    return ecrituresQuery.data.filter(
      (e) => e.fiscalYearId === fiscalYearId && e.validatedAt === null,
    ).length;
  }, [ecrituresQuery.data, fiscalYearId]);

  const isOwner = currentCompany?.role === 'OWNER';
  const pendingInviteCount = isOwner ? (membershipsQuery.data?.pendingInvites.length ?? 0) : 0;

  const anomalies = anomaliesQuery.data;
  const highPayments = anomalies?.payments.filter((p) => p.matchTier === 'HIGH') ?? [];
  const otherPayments = [...(anomalies?.payments.filter((p) => p.matchTier !== 'HIGH') ?? [])].sort(
    (a, b) => b.daysOverdue - a.daysOverdue,
  );
  const sortedSpending = [...(anomalies?.spending ?? [])].sort(
    (a, b) => Number(b.multiplier) - Number(a.multiplier),
  );

  type Item =
    | { kind: 'drafts'; key: 'drafts' }
    | { kind: 'invites'; key: 'invites' }
    | { kind: 'spending'; key: string; anomaly: SpendingAnomaly }
    | { kind: 'payment'; key: string; anomaly: PaymentAnomaly };

  const items: Item[] = [
    ...(draftCount > 0 ? ([{ kind: 'drafts', key: 'drafts' }] as const) : []),
    ...(pendingInviteCount > 0 ? ([{ kind: 'invites', key: 'invites' }] as const) : []),
    ...highPayments.map((a): Item => ({ kind: 'payment', key: a.invoiceId, anomaly: a })),
    ...sortedSpending.map((a): Item => ({ kind: 'spending', key: `${a.accountId}-${a.month}`, anomaly: a })),
    ...otherPayments.map((a): Item => ({ kind: 'payment', key: a.invoiceId, anomaly: a })),
  ].slice(0, MAX_ITEMS);

  const totalAnomalyCount = (anomalies?.spending.length ?? 0) + (anomalies?.payments.length ?? 0);

  // Still loading every source — render nothing rather than a
  // half-populated, briefly-wrong list (matches the prior
  // AnomaliesSection's own "nothing while loading" choice).
  if (ecrituresQuery.isLoading || membershipsQuery.isLoading || anomaliesQuery.isLoading) {
    return <div className="h-24 w-full animate-pulse rounded-lg bg-border" />;
  }
  // A failure on any one source degrades this whole card silently —
  // "something needs attention" must never itself become the thing
  // that breaks the dashboard.
  if (ecrituresQuery.isError || membershipsQuery.isError || anomaliesQuery.isError) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">À surveiller</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            Ce qui mérite un coup d'œil — jamais bloquant, jamais appliqué automatiquement.
          </p>
        </div>
        {totalAnomalyCount > 0 && (
          <Link
            to="/anomalies"
            className="shrink-0 text-[12px] font-medium text-accent hover:text-accent-hover"
          >
            Toutes les anomalies ({totalAnomalyCount}) →
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-ink-faint">Rien à signaler pour le moment.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {items.map((item) => {
            if (item.kind === 'drafts') {
              return (
                <AttentionLinkRow
                  key="drafts"
                  to="/ecritures"
                  label={
                    draftCount === 1
                      ? '1 écriture en brouillon'
                      : `${draftCount} écritures en brouillon`
                  }
                  detail="Bloque la génération des déclarations et de la liasse pour cet exercice."
                />
              );
            }
            if (item.kind === 'invites') {
              return (
                <AttentionLinkRow
                  key="invites"
                  to="/parametres/membres"
                  label={
                    pendingInviteCount === 1
                      ? '1 invitation en attente'
                      : `${pendingInviteCount} invitations en attente`
                  }
                  detail="En attente d'acceptation par les personnes invitées."
                />
              );
            }
            return item.kind === 'spending' ? (
              <SpendingAnomalyRow key={`s-${item.key}`} anomaly={item.anomaly} />
            ) : (
              <PaymentAnomalyRow key={`p-${item.key}`} anomaly={item.anomaly} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttentionLinkRow({ to, label, detail }: { to: string; label: string; detail: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-md border border-warning/40 bg-warning-soft/40 px-3 py-2.5 transition-colors hover:border-warning hover:bg-warning-soft"
    >
      <IconAlertTriangle className="h-4 w-4 shrink-0 text-warning" />
      <div>
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <div className="text-[11px] text-ink-faint">{detail}</div>
      </div>
    </Link>
  );
}
