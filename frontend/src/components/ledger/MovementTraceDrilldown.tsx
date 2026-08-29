import { useState } from 'react';
import type { FiscalYear, Journal } from '../../api/types';
import {
  useTraceTableau2054,
  useTraceTableau2055,
  useTraceTableau2056,
} from '../../api/queries';
import { ApiError } from '../../api/client';
import { formatMoneyFr } from '../../lib/money';
import { AccountLedgerDrilldown } from './AccountLedgerDrilldown';

/**
 * Traceability drill-down, Tier 2 — 2054/2055/2056. See CLAUDE.md
 * "Traceability drill-down" and each backend trace module's own doc
 * comment. One shared component, mirroring Tier 1's `LineTraceDrilldown`
 * — the three backends return genuinely different détail shapes
 * (FixedAsset-rooted for 2054, DepreciationEntry-rooted for 2055,
 * Account-rooted for 2056), normalized here into one common row shape
 * so the rendering — and the "→ écritures" hop into the unmodified
 * `AccountLedgerDrilldown` — stays a single code path.
 *
 * The one real per-row difference this normalization must preserve:
 * `fiscalYearId` is PER-ROW, not fixed for the whole drill-down — a
 * 2055 "début" row may carry a DIFFERENT year than its siblings (each
 * entry's own real year), and a 2054 "début" row carries no hop at all
 * (`drillable: false`) — see tableau-2054-trace.ts's own doc comment
 * for why. Collapsing these into one shared `fiscalYearId` prop the
 * way Tier 1's drill-down does would silently misdate 2055's own
 * "début" hops.
 */
interface NormalizedRow {
  key: string;
  label: string;
  sublabel: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  fiscalYearId: string;
  contribution: string;
  drillable: boolean;
}

export function MovementTraceDrilldown({
  family,
  fiscalYearId,
  fiscalYears,
  code,
  column,
  journals,
}: {
  family: '2054' | '2055' | '2056';
  fiscalYearId: string;
  fiscalYears: FiscalYear[];
  code: string;
  column: string;
  journals: Journal[];
}) {
  const q2054 = useTraceTableau2054(
    family === '2054' ? fiscalYearId : null,
    family === '2054' ? code : null,
    family === '2054' ? (column as 'debut' | 'acquisitions' | 'cessions') : null,
  );
  const q2055 = useTraceTableau2055(
    family === '2055' ? fiscalYearId : null,
    family === '2055' ? code : null,
    family === '2055' ? (column as 'debut' | 'dotations' | 'diminutions') : null,
  );
  const q2056 = useTraceTableau2056(
    family === '2056' ? fiscalYearId : null,
    family === '2056' ? code : null,
    family === '2056' ? (column as 'debut' | 'dotations' | 'reprises') : null,
  );
  const query = family === '2054' ? q2054 : family === '2055' ? q2055 : q2056;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
        : "Cette cellule n'a pas pu être tracée.";
    return (
      <div className="border-t border-border bg-bg px-5 py-3 text-[12.5px] italic text-ink-faint">
        {message}
      </div>
    );
  }

  let columnValue: string;
  let rows: NormalizedRow[];
  if (family === '2054' && q2054.data) {
    columnValue = q2054.data.columnValue;
    rows = q2054.data.assets.map((a) => ({
      key: a.assetId,
      label: a.assetLabel,
      sublabel: '',
      accountId: a.accountId,
      accountNumber: a.accountNumber,
      accountLabel: a.accountLabel,
      fiscalYearId,
      contribution: a.contribution,
      drillable: q2054.data!.drillableToEcritures,
    }));
  } else if (family === '2055' && q2055.data) {
    columnValue = q2055.data.columnValue;
    rows = q2055.data.details.map((d) => ({
      key: `${d.assetId}-${d.fiscalYearId}`,
      label: d.assetLabel,
      // Resolved to the real fiscal-year label (e.g. "2025"), never the raw id — fiscalYears comes
      // from the same app-wide list the year picker itself uses. "exercice antérieur" is the honest
      // fallback if a year genuinely isn't in that list (shouldn't happen in practice), not a guess
      // at which one it is.
      sublabel:
        d.fiscalYearId === fiscalYearId
          ? ''
          : `exercice ${fiscalYears.find((fy) => fy.id === d.fiscalYearId)?.label ?? 'antérieur'}`,
      accountId: d.accountId,
      accountNumber: d.accountNumber,
      accountLabel: d.accountLabel,
      fiscalYearId: d.fiscalYearId,
      contribution: d.contribution,
      drillable: true,
    }));
  } else if (family === '2056' && q2056.data) {
    columnValue = q2056.data.columnValue;
    rows = q2056.data.accounts.map((a) => ({
      key: a.accountId,
      label: a.accountLabel,
      sublabel: '',
      accountId: a.accountId,
      accountNumber: a.accountNumber,
      accountLabel: a.accountLabel,
      fiscalYearId,
      contribution: a.contribution,
      drillable: true,
    }));
  } else {
    return null;
  }

  return (
    <div className="border-t border-border bg-bg px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between text-[12.5px]">
        <span className="font-semibold text-ink">Détail de cette cellule</span>
        <span className="tabular-nums text-ink-muted">
          Total tracé : <span className="font-medium text-ink">{formatMoneyFr(columnValue)}</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Aucune contribution pour cette cellule.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <div key={row.key} className="overflow-hidden rounded-md border border-border bg-surface">
              <button
                type="button"
                disabled={!row.drillable}
                onClick={() => row.drillable && setExpandedKey((k) => (k === row.key ? null : row.key))}
                className={[
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px]',
                  row.drillable ? 'hover:bg-bg' : 'cursor-default',
                ].join(' ')}
              >
                <span className="text-ink-faint">
                  {row.drillable ? (expandedKey === row.key ? '▾' : '▸') : '·'}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {row.label}
                  {row.sublabel && <span className="ml-1.5 text-ink-faint">({row.sublabel})</span>}
                </span>
                <span className="tabular-nums text-ink-faint">{row.accountNumber}</span>
                <span className="tabular-nums font-medium text-ink">
                  {formatMoneyFr(row.contribution)}
                </span>
              </button>
              {expandedKey === row.key && row.drillable && (
                <AccountLedgerDrilldown
                  accountId={row.accountId}
                  accountNumber={row.accountNumber}
                  accountLabel={row.accountLabel}
                  fiscalYearId={row.fiscalYearId}
                  journals={journals}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {rows.some((r) => !r.drillable) && (
        <p className="mt-2 text-[11.5px] italic text-ink-faint">
          « Début » n'a pas d'écriture rattachée ici — la date d'acquisition n'est pas reliée à un
          exercice précis dans le modèle de données. La liste ci-dessus reste correcte et
          contrôlée, seule l'étape suivante (→ écritures) n'est pas offerte.
        </p>
      )}
    </div>
  );
}
