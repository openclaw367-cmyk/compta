import { Fragment, useState } from 'react';
import type { Journal, TrialBalanceResponse } from '../../api/types';
import { formatMoneyFr, isZeroMoney } from '../../lib/money';
import { AccountLedgerDrilldown } from './AccountLedgerDrilldown';

export function TrialBalanceTable({
  data,
  fiscalYearId,
  periodStart,
  periodEnd,
  journals,
}: {
  data: TrialBalanceResponse;
  fiscalYearId: string;
  periodStart?: string;
  periodEnd?: string;
  journals: Journal[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (data.lines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
        Aucun mouvement pour cette période.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5 font-semibold">Compte</th>
            <th className="px-4 py-2.5 text-right font-semibold">Débit</th>
            <th className="px-4 py-2.5 text-right font-semibold">Crédit</th>
            <th className="px-4 py-2.5 text-right font-semibold">Solde</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line) => {
            const isExpanded = expandedId === line.accountId;
            return (
              <Fragment key={line.accountId}>
                <tr
                  onClick={() => setExpandedId(isExpanded ? null : line.accountId)}
                  className={[
                    'cursor-pointer border-b border-border last:border-b-0',
                    isExpanded ? 'bg-accent-soft' : 'hover:bg-bg',
                  ].join(' ')}
                >
                  <td className="px-4 py-2.5 text-ink">
                    <span className="tabular-nums text-ink-muted">{line.accountNumber}</span>{' '}
                    {line.accountLabel}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                    {isZeroMoney(line.totalDebit) ? '—' : formatMoneyFr(line.totalDebit)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                    {isZeroMoney(line.totalCredit) ? '—' : formatMoneyFr(line.totalCredit)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                    {formatMoneyFr(line.balance)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={4} className="p-0">
                      <AccountLedgerDrilldown
                        accountId={line.accountId}
                        accountNumber={line.accountNumber}
                        accountLabel={line.accountLabel}
                        fiscalYearId={fiscalYearId}
                        periodStart={periodStart}
                        periodEnd={periodEnd}
                        journals={journals}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border-strong bg-bg font-semibold">
            <td className="px-4 py-2.5 text-ink-muted">Total</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-ink">
              {formatMoneyFr(data.totals.debit)}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-ink">
              {formatMoneyFr(data.totals.credit)}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-ink">
              {formatMoneyFr(data.totals.balance)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
