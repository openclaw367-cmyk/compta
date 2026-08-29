import { useState } from 'react';
import type { Journal, Regime } from '../../api/types';
import { useTraceBilanLine, useTraceCdrLine } from '../../api/queries';
import { ApiError } from '../../api/client';
import { formatMoneyFr } from '../../lib/money';
import { AccountLedgerDrilldown } from './AccountLedgerDrilldown';

/**
 * Traceability drill-down, Tier 1 — see CLAUDE.md "Traceability
 * drill-down" and specs/liasse-drilldown-traceability-implementation-spec.md.
 * Shown when a bilan/CDR line row is expanded: lists the accounts the
 * backend's reverse mapping found for this line (already asserted
 * server-side to sum to the line's own value — nothing is re-verified
 * client-side, same "trust the backend's own throw" discipline as
 * every other compliance check in this app), each expandable into the
 * EXACT SAME `AccountLedgerDrilldown` Grand Livre already uses — no new
 * écriture-list rendering here at all.
 *
 * A non-drillable line (e.g. bilan's own DI, a CDR subtotal reached via
 * an unguarded click) surfaces the backend's own refusal message
 * honestly rather than an empty or broken-looking table — see
 * `traceLine()`'s own doc comment on the backend for why that refusal
 * exists.
 */
export function LineTraceDrilldown({
  family,
  fiscalYearId,
  lineCode,
  regime,
  journals,
}: {
  family: 'bilan' | 'cdr';
  fiscalYearId: string;
  lineCode: string;
  /**
   * The regime of the SECTION this row belongs to — the primary report
   * passes the company's own official regime, the comparison view passes
   * the OTHER one. Never assume it matches Company.regime; see
   * useTraceBilanLine's own doc comment.
   */
  regime: Regime;
  journals: Journal[];
}) {
  const bilanQuery = useTraceBilanLine(
    family === 'bilan' ? fiscalYearId : null,
    family === 'bilan' ? lineCode : null,
    family === 'bilan' ? regime : null,
  );
  const cdrQuery = useTraceCdrLine(
    family === 'cdr' ? fiscalYearId : null,
    family === 'cdr' ? lineCode : null,
    family === 'cdr' ? regime : null,
  );
  const query = family === 'bilan' ? bilanQuery : cdrQuery;
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <div className="border-t border-border bg-bg px-5 py-3 text-[12.5px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  if (query.isError) {
    const message =
      query.error instanceof ApiError
        ? query.error.details.join(' ')
        : "Cette ligne n'a pas pu être tracée.";
    return (
      <div className="border-t border-border bg-bg px-5 py-3 text-[12.5px] italic text-ink-faint">
        {message}
      </div>
    );
  }

  const result = query.data;
  if (!result) return null;

  return (
    <div className="border-t border-border bg-bg px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between text-[12.5px]">
        <span className="font-semibold text-ink">
          Comptes contribuant à la ligne{' '}
          <span className="tabular-nums text-ink-faint">{result.lineCode}</span>
        </span>
        <span className="tabular-nums text-ink-muted">
          Total tracé : <span className="font-medium text-ink">{formatMoneyFr(result.lineValue)}</span>
        </span>
      </div>

      {result.accounts.length === 0 ? (
        <p className="text-[12px] text-ink-faint">
          Aucun compte ne contribue à cette ligne pour cet exercice.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {result.accounts.map((a) => (
            <div key={a.accountId} className="overflow-hidden rounded-md border border-border bg-surface">
              <button
                type="button"
                onClick={() =>
                  setExpandedAccountId((current) => (current === a.accountId ? null : a.accountId))
                }
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] hover:bg-bg"
              >
                <span className="text-ink-faint">{expandedAccountId === a.accountId ? '▾' : '▸'}</span>
                <span className="tabular-nums text-ink-muted">{a.accountNumber}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{a.accountLabel}</span>
                <span className="tabular-nums font-medium text-ink">{formatMoneyFr(a.contribution)}</span>
              </button>
              {expandedAccountId === a.accountId && (
                <AccountLedgerDrilldown
                  accountId={a.accountId}
                  accountNumber={a.accountNumber}
                  accountLabel={a.accountLabel}
                  fiscalYearId={fiscalYearId}
                  journals={journals}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
