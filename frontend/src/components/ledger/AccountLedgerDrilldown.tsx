import { useMemo, useState } from 'react';
import type { AccountLedgerLine, Journal, LedgerTotals } from '../../api/types';
import { useAccountLedger } from '../../api/queries';
import { addMoneyStrings, formatMoneyFr, isZeroMoney, subtractMoneyStrings } from '../../lib/money';

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * The backend has no server-side journal filter for this endpoint (a
 * trial balance / grand livre is inherently cross-journal). The journal
 * dropdown here filters the already-fetched lines client-side and
 * recomputes the running balance and totals from that filtered subset —
 * once filtered, those numbers describe "this journal's movements on the
 * account", not the account's true balance, so they're recomputed from
 * scratch rather than sliced out of the real series (which would produce
 * a running balance that jumps in ways that don't sum to what's shown).
 */
function recompute(lines: AccountLedgerLine[]): { lines: AccountLedgerLine[]; totals: LedgerTotals } {
  let running = '0.00';
  let debit = '0.00';
  let credit = '0.00';
  const withRunningBalance = lines.map((line) => {
    running = subtractMoneyStrings(addMoneyStrings(running, line.debit), line.credit);
    debit = addMoneyStrings(debit, line.debit);
    credit = addMoneyStrings(credit, line.credit);
    return { ...line, runningBalance: running };
  });
  return {
    lines: withRunningBalance,
    totals: { debit, credit, balance: subtractMoneyStrings(debit, credit) },
  };
}

export function AccountLedgerDrilldown({
  accountId,
  accountNumber,
  accountLabel,
  fiscalYearId,
  periodStart,
  periodEnd,
  journals,
}: {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  fiscalYearId: string;
  periodStart?: string;
  periodEnd?: string;
  journals: Journal[];
}) {
  const [journalFilter, setJournalFilter] = useState('');
  const { data, isLoading } = useAccountLedger(accountId, {
    fiscalYearId,
    periodStart,
    periodEnd,
  });

  const { lines, totals } = useMemo(() => {
    if (!data) return { lines: [], totals: { debit: '0.00', credit: '0.00', balance: '0.00' } };
    if (!journalFilter) return { lines: data.lines, totals: data.totals };
    return recompute(data.lines.filter((l) => l.journalCode === journalFilter));
  }, [data, journalFilter]);

  return (
    <div className="border-t border-border bg-bg px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[12.5px] font-semibold text-ink">
          Grand livre — <span className="tabular-nums text-ink-muted">{accountNumber}</span>{' '}
          {accountLabel}
        </h3>
        <select
          value={journalFilter}
          onChange={(e) => setJournalFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
        >
          <option value="">Tous les journaux</option>
          {journals.map((j) => (
            <option key={j.id} value={j.code}>
              {j.code} — {j.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="py-4 text-center text-[13px] text-ink-faint">Chargement…</p>
      ) : lines.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-ink-faint">Aucune écriture pour ce filtre.</p>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="py-1.5 pr-3 font-semibold">Date</th>
              <th className="py-1.5 pr-3 font-semibold">Journal</th>
              <th className="py-1.5 pr-3 font-semibold">Pièce</th>
              <th className="py-1.5 pr-3 font-semibold">Libellé</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Débit</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Crédit</th>
              <th className="py-1.5 pr-3 font-semibold">Lettrage</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Solde</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr
                key={`${line.ecritureId}-${index}`}
                className="border-b border-border/70 last:border-b-0"
              >
                <td className="py-1.5 pr-3 tabular-nums text-ink-muted">
                  {formatDate(line.ecritureDate)}
                </td>
                <td className="py-1.5 pr-3 text-ink-muted">{line.journalCode}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{line.pieceRef ?? '—'}</td>
                <td className="py-1.5 pr-3 text-ink">{line.libelle}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                  {isZeroMoney(line.debit) ? '—' : formatMoneyFr(line.debit)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                  {isZeroMoney(line.credit) ? '—' : formatMoneyFr(line.credit)}
                </td>
                <td className="py-1.5 pr-3 text-ink-muted">{line.lettrage ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums font-medium text-ink">
                  {formatMoneyFr(line.runningBalance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-strong font-semibold">
              <td colSpan={4} className="py-1.5 pr-3 text-ink-muted">
                Total{journalFilter ? ' (journal filtré)' : ''}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                {formatMoneyFr(totals.debit)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                {formatMoneyFr(totals.credit)}
              </td>
              <td />
              <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                {formatMoneyFr(totals.balance)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
