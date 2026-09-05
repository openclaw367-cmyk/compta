import type { ActivityEvent } from '../../api/types';
import { useActivityFeed } from '../../api/queries';
import { IconUsers } from '../layout/icons';

const RELATIVE_TIME = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'seconds' },
  { amount: 60, unit: 'minutes' },
  { amount: 24, unit: 'hours' },
  { amount: 7, unit: 'days' },
  { amount: 4.34524, unit: 'weeks' },
  { amount: 12, unit: 'months' },
  { amount: Number.POSITIVE_INFINITY, unit: 'years' },
];

/** "il y a 3 heures", "hier", ... — no existing helper in lib/ for this, small and self-contained here. */
function formatRelativeTime(iso: string): string {
  let duration = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return RELATIVE_TIME.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return RELATIVE_TIME.format(Math.round(duration), 'years');
}

function describeEvent(event: ActivityEvent): string {
  switch (event.type) {
    case 'MEMBER_INVITED':
      return `${event.actorEmail} a invité ${event.targetEmail}`;
    case 'MEMBER_INVITE_ACCEPTED':
      return `${event.actorEmail} a rejoint l'équipe`;
    case 'MEMBER_ROLE_CHANGED':
      return `${event.actorEmail} a changé le rôle de ${event.targetEmail}${event.detail ? ` (${event.detail})` : ''}`;
    case 'MEMBER_REMOVED':
      return `${event.actorEmail} a retiré ${event.targetEmail} de l'équipe`;
  }
}

/**
 * Recent team activity — see CLAUDE.md "Activity feed". Scoped to
 * membership actions only this pass (invited/accepted/role-changed/
 * removed) — see ActivityService's own doc comment for why écriture/
 * invoice/fiscal-year events aren't included yet. A read-only, purely
 * observational feed: no action here writes anything, so a load
 * failure degrades to nothing rather than an error banner, matching
 * this app's own AnomaliesSection/NeedsAttentionPanel precedent for a
 * secondary, non-blocking dashboard-style section.
 */
export function ActivityFeedSection() {
  const activityQuery = useActivityFeed();

  if (activityQuery.isLoading) {
    return <div className="h-32 w-full animate-pulse rounded-lg bg-border" />;
  }
  if (activityQuery.isError || !activityQuery.data) {
    return null;
  }

  const events = activityQuery.data;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Activité récente
      </h2>
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {events.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-ink-faint">Aucune activité pour le moment.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 px-4 py-2.5">
                <IconUsers className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-ink">{describeEvent(event)}</div>
                  <div className="text-[11px] text-ink-faint">
                    {formatRelativeTime(event.createdAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
