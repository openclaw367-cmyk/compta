import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Journal, TrialBalanceLine, TrialBalanceResponse } from '../../api/types';
import { compareMoneyStrings, formatMoneyFr, isZeroMoney } from '../../lib/money';
import { AccountLedgerDrilldown } from './AccountLedgerDrilldown';

type SortKey = 'compte' | 'solde';

const PCG_CLASS_LABEL: Record<string, string> = {
  '1': 'Classe 1 — Capitaux',
  '2': 'Classe 2 — Immobilisations',
  '3': 'Classe 3 — Stocks',
  '4': 'Classe 4 — Tiers',
  '5': 'Classe 5 — Financiers',
  '6': 'Classe 6 — Charges',
  '7': 'Classe 7 — Produits',
  '8': 'Classe 8 — Comptes spéciaux',
};

export function TrialBalanceTable({
  data,
  fiscalYearId,
  periodStart,
  periodEnd,
  journals,
  initialExpandedAccountId,
}: {
  data: TrialBalanceResponse;
  fiscalYearId: string;
  periodStart?: string;
  periodEnd?: string;
  journals: Journal[];
  /** Pre-expands (and scrolls to) a specific account row — the mechanism
   * behind `/grand-livre?compte=<accountId>` deep links from other
   * screens (e.g. the dashboard's comptes-courants tiles). Pure
   * navigation: this only changes which already-fetched row starts
   * expanded, never what's fetched or computed. */
  initialExpandedAccountId?: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedAccountId ?? null);
  const hasScrolled = useRef(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('compte');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (!initialExpandedAccountId || hasScrolled.current) return;
    const row = document.getElementById(`compte-${initialExpandedAccountId}`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      hasScrolled.current = true;
    }
  }, [initialExpandedAccountId, data]);

  const filteredLines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let lines: TrialBalanceLine[] = data.lines;
    if (needle !== '') {
      lines = lines.filter(
        (l) =>
          l.accountNumber.toLowerCase().includes(needle) ||
          l.accountLabel.toLowerCase().includes(needle),
      );
    }
    return [...lines].sort((a, b) => {
      const cmp =
        sortKey === 'compte'
          ? a.accountNumber.localeCompare(b.accountNumber)
          : compareMoneyStrings(a.balance, b.balance);
      return sortAsc ? cmp : -cmp;
    });
  }, [data.lines, search, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((asc) => !asc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  if (data.lines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
        Aucun mouvement pour cette période.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un compte — numéro ou libellé…"
          className="w-72 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        {search.trim() !== '' && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-ink-muted hover:bg-bg"
          >
            Réinitialiser
          </button>
        )}
        <span className="ml-auto text-[12px] text-ink-faint">
          {filteredLines.length} compte{filteredLines.length !== 1 ? 's' : ''}
          {search.trim() !== '' ? ` sur ${data.lines.length}` : ''}
        </span>
      </div>

      {filteredLines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
          Aucun compte ne correspond à « {search} ».
        </div>
      ) : (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <th
              onClick={() => toggleSort('compte')}
              className="cursor-pointer select-none px-4 py-2.5 font-semibold hover:text-ink"
            >
              Compte {sortKey === 'compte' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th className="px-4 py-2.5 text-right font-semibold">Débit</th>
            <th className="px-4 py-2.5 text-right font-semibold">Crédit</th>
            <th
              onClick={() => toggleSort('solde')}
              className="cursor-pointer select-none px-4 py-2.5 text-right font-semibold hover:text-ink"
            >
              Solde {sortKey === 'solde' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredLines.map((line, index) => {
            const isExpanded = expandedId === line.accountId;
            // Class dividers only make sense in the account's own natural
            // numeric order — sorting by solde or filtering by search
            // scatters classes, so this stays a plain flat list then.
            const groupingActive = sortKey === 'compte' && sortAsc && search.trim() === '';
            const pcgClass = line.accountNumber.charAt(0);
            const priorClass = index > 0 ? filteredLines[index - 1].accountNumber.charAt(0) : null;
            const showClassDivider = groupingActive && pcgClass !== priorClass;
            return (
              <Fragment key={line.accountId}>
                {showClassDivider && (
                  <tr>
                    <td
                      colSpan={4}
                      className="bg-bg px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint"
                    >
                      {PCG_CLASS_LABEL[pcgClass] ?? `Classe ${pcgClass}`}
                    </td>
                  </tr>
                )}
                <tr
                  id={`compte-${line.accountId}`}
                  onClick={() => setExpandedId(isExpanded ? null : line.accountId)}
                  className={[
                    'cursor-pointer border-b border-border last:border-b-0 scroll-mt-4',
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
      )}
    </div>
  );
}
