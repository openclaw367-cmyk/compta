import { useState } from 'react';
import type { CashFlowDeltaLineKey, Journal } from '../../api/types';
import {
  useTraceCashFlowDeltaLine,
  useTraceCashFlowOpeningBilanLine,
} from '../../api/queries';
import { ApiError } from '../../api/client';
import { formatMoneyFr } from '../../lib/money';
import { LineTraceDrilldown } from './LineTraceDrilldown';
import { AccountLedgerDrilldown } from './AccountLedgerDrilldown';

/**
 * Traceability drill-down, Tier 4 — a "clean bilan-line delta" flux
 * line (variationCreancesClients, variationStocks,
 * variationDettesExploitation, variationDettesSurImmobilisations,
 * variationEmprunts, variationCapital). See CLAUDE.md "Traceability
 * drill-down (Tier 4)" and `cash-flow-trace.ts`'s own doc comment.
 *
 * Side by side: the OUVERTURE (à-nouveau) side and the CLÔTURE side,
 * each a list of the one-or-more bilan line codes the flux line sums.
 * The CLÔTURE side reuses the EXISTING Tier 1 `LineTraceDrilldown
 * family="bilan"` directly (same fiscalYearId, regime REEL_NORMAL — see
 * `FormulaTraceDrilldown`'s own doc comment for why that's always
 * correct here); the OUVERTURE side has no existing equivalent, so
 * `OpeningCodeRow` below is the one genuinely new piece, hitting the
 * new `/cash-flow/trace-opening-bilan-line` endpoint and then expanding
 * into the UNMODIFIED `AccountLedgerDrilldown`, scoped via
 * `periodStart`/`periodEnd` to exactly the à-nouveau line's own date.
 */
export function CashFlowDeltaLineDrilldown({
  fiscalYearId,
  lineKey,
  journals,
}: {
  fiscalYearId: string;
  lineKey: CashFlowDeltaLineKey;
  journals: Journal[];
}) {
  const query = useTraceCashFlowDeltaLine(fiscalYearId, lineKey);
  const [expandedClosingCode, setExpandedClosingCode] = useState<string | null>(null);
  const [expandedOpeningCode, setExpandedOpeningCode] = useState<string | null>(null);

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
        <span className="font-semibold text-ink">Décomposition de « {result.label} »</span>
        <span className="tabular-nums text-ink-muted">
          Delta tracé :{' '}
          <span className="font-medium text-ink">{formatMoneyFr(result.officialValue)}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <span>Ouverture (à-nouveau)</span>
            <span className="tabular-nums">{formatMoneyFr(result.opening.totalValue)}</span>
          </div>
          {result.opening.codes.map((code) => (
            <OpeningCodeRow
              key={code.code}
              fiscalYearId={fiscalYearId}
              code={code.code}
              label={code.label}
              value={code.value}
              expanded={expandedOpeningCode === code.code}
              onToggle={() =>
                setExpandedOpeningCode((current) => (current === code.code ? null : code.code))
              }
              journals={journals}
            />
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <span>Clôture</span>
            <span className="tabular-nums">{formatMoneyFr(result.closing.totalValue)}</span>
          </div>
          {result.closing.codes.map((code) => {
            const expanded = expandedClosingCode === code.code;
            return (
              <div key={code.code} className="overflow-hidden rounded-md border border-border bg-surface">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedClosingCode((current) => (current === code.code ? null : code.code))
                  }
                  className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12px] hover:bg-bg"
                >
                  <span className="text-ink-faint">{expanded ? '▾' : '▸'}</span>
                  <span className="tabular-nums text-ink-faint">{code.code}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted">{code.label}</span>
                  <span className="tabular-nums text-ink">{formatMoneyFr(code.value)}</span>
                </button>
                {expanded && (
                  <LineTraceDrilldown
                    family="bilan"
                    fiscalYearId={fiscalYearId}
                    lineCode={code.code}
                    regime="REEL_NORMAL"
                    journals={journals}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * One OUVERTURE-side code, expandable to its own contributing accounts
 * (via the new backend endpoint) and then further into
 * `AccountLedgerDrilldown`, scoped to exactly the à-nouveau line's own
 * date (`openingDate`, the SAME value for `periodStart` and
 * `periodEnd`) — never the full fiscal year, which would show every
 * movement on the account, not just the opening balance this figure
 * actually represents.
 */
function OpeningCodeRow({
  fiscalYearId,
  code,
  label,
  value,
  expanded,
  onToggle,
  journals,
}: {
  fiscalYearId: string;
  code: string;
  label: string;
  value: string;
  expanded: boolean;
  onToggle: () => void;
  journals: Journal[];
}) {
  const query = useTraceCashFlowOpeningBilanLine(expanded ? fiscalYearId : null, expanded ? code : null);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12px] hover:bg-bg"
      >
        <span className="text-ink-faint">{expanded ? '▾' : '▸'}</span>
        <span className="tabular-nums text-ink-faint">{code}</span>
        <span className="min-w-0 flex-1 truncate text-ink-muted">{label}</span>
        <span className="tabular-nums text-ink">{formatMoneyFr(value)}</span>
      </button>
      {expanded && (
        <div className="border-t border-border bg-bg px-3 py-2.5">
          {query.isPending ? (
            <p className="text-[11.5px] text-ink-faint">Chargement…</p>
          ) : query.isError ? (
            <p className="text-[11.5px] italic text-ink-faint">
              {query.error instanceof ApiError
                ? query.error.details.join(' ')
                : "Ce côté n'a pas pu être tracé."}
            </p>
          ) : query.data && query.data.accounts.length === 0 ? (
            <p className="text-[11.5px] text-ink-faint">
              Aucun compte ne contribue à ce côté pour cet exercice.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {query.data?.accounts.map((a) => (
                <div key={a.accountId} className="overflow-hidden rounded-md border border-border/70">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedAccountId((current) => (current === a.accountId ? null : a.accountId))
                    }
                    className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12px] hover:bg-surface"
                  >
                    <span className="text-ink-faint">
                      {expandedAccountId === a.accountId ? '▾' : '▸'}
                    </span>
                    <span className="tabular-nums text-ink-faint">{a.accountNumber}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-muted">{a.accountLabel}</span>
                    <span className="tabular-nums text-ink">{formatMoneyFr(a.contribution)}</span>
                  </button>
                  {expandedAccountId === a.accountId && query.data && (
                    <AccountLedgerDrilldown
                      accountId={a.accountId}
                      accountNumber={a.accountNumber}
                      accountLabel={a.accountLabel}
                      fiscalYearId={query.data.fiscalYearId}
                      periodStart={query.data.openingDate}
                      periodEnd={query.data.openingDate}
                      journals={journals}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
