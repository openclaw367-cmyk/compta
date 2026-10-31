import { useState } from 'react';
import type { FinancialAnalysisFormulaKey, Journal } from '../../api/types';
import { useTraceCashFlowCaf, useTraceFinancialAnalysisFormula } from '../../api/queries';
import { ApiError } from '../../api/client';
import { formatMoneyFr } from '../../lib/money';
import { LineTraceDrilldown } from './LineTraceDrilldown';

/**
 * Traceability drill-down, Tier 4 — "formula trace". See CLAUDE.md
 * "Traceability drill-down (Tier 4)". Shared by the cash-flow CAF trace
 * and the financial-analysis SIG-cascade trace (margeCommerciale/
 * valeurAjoutee/ebe) — both backends return the exact same
 * `{terms: [{key, label, sign, value, codes?, nonTraceableReason?}]}`
 * shape, so one component renders either.
 *
 * Each term is either:
 * - a sum of real compte-de-résultat (`CDR_RULES`) codes — each code is
 *   independently expandable into the EXISTING Tier 1 `LineTraceDrilldown
 *   family="cdr"`, reused verbatim (never re-implemented here); or
 * - a genuine non-drillable derived subtotal (e.g. CAF's own résultat
 *   net) — shown with its own honest `nonTraceableReason`, never a dead
 *   `▸` affordance.
 *
 * `regime="REEL_NORMAL"` is hardcoded for the CDR expansion, not a
 * caller prop — cash-flow-statement.ts/financial-analysis.ts always
 * compute their own bilan/CDR via the 2050-series engine regardless of
 * `Company.regime` (a pre-existing fact of those two modules, unrelated
 * to this drill-down), so the regime of the underlying trial balance is
 * never ambiguous here the way it is for `LiassePage`'s own comparison
 * view.
 */
export function FormulaTraceDrilldown({
  source,
  fiscalYearId,
  formulaKey,
  journals,
}: {
  source: 'caf' | 'sig';
  fiscalYearId: string;
  formulaKey: FinancialAnalysisFormulaKey | 'capaciteAutofinancement';
  journals: Journal[];
}) {
  const cafQuery = useTraceCashFlowCaf(source === 'caf' ? fiscalYearId : null);
  const sigQuery = useTraceFinancialAnalysisFormula(
    source === 'sig' ? fiscalYearId : null,
    source === 'sig' ? (formulaKey as FinancialAnalysisFormulaKey) : null,
  );
  const query = source === 'caf' ? cafQuery : sigQuery;
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

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
        : "Cette formule n'a pas pu être tracée.";
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
          Total tracé : <span className="font-medium text-ink">{formatMoneyFr(result.officialValue)}</span>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {result.terms.map((term) => (
          <div key={term.key} className="overflow-hidden rounded-md border border-border bg-surface p-2.5">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-ink">
                {term.sign === -1 ? '− ' : '+ '}
                {term.label}
              </span>
              <span className="tabular-nums font-medium text-ink">{formatMoneyFr(term.value)}</span>
            </div>
            {term.nonTraceableReason ? (
              <p className="mt-1.5 text-[11.5px] italic text-ink-faint">{term.nonTraceableReason}</p>
            ) : (
              <div className="mt-1.5 flex flex-col gap-1">
                {(term.codes ?? []).map((code) => {
                  const key = `${term.key}-${code.code}`;
                  const expanded = expandedCode === key;
                  return (
                    <div key={key} className="overflow-hidden rounded-md border border-border/70 bg-bg">
                      <button
                        type="button"
                        onClick={() => setExpandedCode((current) => (current === key ? null : key))}
                        className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12px] hover:bg-surface"
                      >
                        <span className="text-ink-faint">{expanded ? '▾' : '▸'}</span>
                        <span className="tabular-nums text-ink-faint">{code.code}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-muted">{code.label}</span>
                        <span className="tabular-nums text-ink">{formatMoneyFr(code.value)}</span>
                      </button>
                      {expanded && (
                        <LineTraceDrilldown
                          family="cdr"
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
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
