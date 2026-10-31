import type { BudgetVarianceReport } from '../../api/types';
import { formatMoneyFr, formatPercent, isNegativeMoney, isZeroMoney } from '../../lib/money';

/**
 * Budget vs. actual variance report — see CLAUDE.md "Budgeting /
 * forecasting". The HonestyBanner below is a REQUIRED element on this
 * screen, not polish: see its own doc comment.
 */
export function BudgetVarianceView({ report }: { report: BudgetVarianceReport }) {
  return (
    <div className="flex flex-col gap-4">
      <HonestyBanner />

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-bg/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5">Compte</th>
              <th className="px-4 py-2.5 text-right">Planifié</th>
              <th className="px-4 py-2.5 text-right">Réel</th>
              <th className="px-4 py-2.5 text-right">Écart</th>
              <th className="px-4 py-2.5 text-right">Écart %</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr key={line.accountId} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2.5 text-ink">
                  <span className="font-medium">{line.accountNumber}</span>{' '}
                  <span className="text-ink-muted">{line.accountLabel}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                  {formatMoneyFr(line.plannedAmount)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                  {formatMoneyFr(line.actualAmount)}
                </td>
                <td
                  className={[
                    'px-4 py-2.5 text-right tabular-nums font-medium',
                    varianceToneClass(line.variance),
                  ].join(' ')}
                >
                  {formatMoneyFr(line.variance)}
                </td>
                <td className={['px-4 py-2.5 text-right tabular-nums', varianceToneClass(line.variance)].join(' ')}>
                  {formatPercent(line.variancePercent)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border-strong bg-bg/60 font-semibold">
              <td className="px-4 py-2.5 text-ink">Total</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                {formatMoneyFr(report.totals.plannedAmount)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                {formatMoneyFr(report.totals.actualAmount)}
              </td>
              <td className={['px-4 py-2.5 text-right tabular-nums', varianceToneClass(report.totals.variance)].join(' ')}>
                {formatMoneyFr(report.totals.variance)}
              </td>
              <td className={['px-4 py-2.5 text-right tabular-nums', varianceToneClass(report.totals.variance)].join(' ')}>
                {formatPercent(report.totals.variancePercent)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function varianceToneClass(variance: string): string {
  if (isZeroMoney(variance)) return 'text-ink-muted';
  return isNegativeMoney(variance) ? 'text-positive' : 'text-negative';
}

// ---------------------------------------------------------------------------
// The honesty banner — a required design element, not optional polish. See
// CLAUDE.md "Budgeting / forecasting" and the résultat fiscal module's own
// banner (CLAUDE.md "Détermination du résultat fiscal"), which this one
// deliberately mirrors in both wording discipline and styling (amber, never
// green — this is not a reconciliation success state).
// ---------------------------------------------------------------------------

function HonestyBanner() {
  return (
    <div className="rounded-lg border-2 border-warning bg-warning-soft p-5">
      <div className="text-[13px] font-bold uppercase tracking-wide text-warning">
        Ce tableau compare correctement — il ne vérifie pas que le budget est pertinent
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink">
        L&rsquo;écart ci-dessous (<strong>réel − planifié</strong>, et le pourcentage associé) est
        calculé correctement à partir du grand livre réel de cet exercice. Mais le montant
        planifié lui-même est une saisie humaine, pas un fait comptable dérivé — cette
        application ne peut pas vérifier que le budget est juste, seulement que la comparaison
        avec les chiffres réels a été effectuée correctement sur ce qui a été saisi.
      </p>
    </div>
  );
}
