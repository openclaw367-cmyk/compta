import { Link } from 'react-router-dom';
import type { PaymentAnomaly, SpendingAnomaly } from '../../api/types';
import { formatMoneyFr } from '../../lib/money';

const MONTH_LABELS_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

/** "2026-07" → "Juillet 2026". */
function formatMonthFr(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTH_LABELS_FR[month - 1]} ${year}`;
}

/** First/last calendar day of a "YYYY-MM" month, as ISO date strings — for the grand-livre deep link. */
function monthBounds(monthKey: string): { start: string; end: string } {
  const [year, month] = monthKey.split('-').map(Number);
  const start = `${monthKey}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/** A clickable row, styled to match this app's established
 *  ComptesCourantsSection/RecentBankEntriesSection dashboard vocabulary
 *  — reused as-is by both the dashboard tile and the dedicated page. */
export function SpendingAnomalyRow({ anomaly }: { anomaly: SpendingAnomaly }) {
  const { start, end } = monthBounds(anomaly.month);
  return (
    <Link
      to={`/grand-livre?compte=${anomaly.accountId}&periodStart=${start}&periodEnd=${end}`}
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:border-accent-soft hover:bg-accent-soft/30"
    >
      <div>
        <div className="text-[13px] font-medium text-ink">{anomaly.accountLabel}</div>
        <div className="text-[11px] text-ink-faint">
          {anomaly.accountNumber} — {formatMonthFr(anomaly.month)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[14px] font-semibold tabular-nums text-warning">
          {formatMoneyFr(anomaly.currentAmount)}
        </div>
        <div className="text-[10.5px] text-ink-faint">
          {anomaly.multiplier}× la moyenne ({formatMoneyFr(anomaly.trailingAverage)} sur{' '}
          {anomaly.monthsOfHistory} mois)
        </div>
      </div>
    </Link>
  );
}

const MATCH_TIER_LABEL: Record<PaymentAnomaly['matchTier'], { text: string; tone: string }> = {
  HIGH: { text: 'Règlement probable trouvé', tone: 'text-positive' },
  AMBIGUOUS: { text: 'Plusieurs mouvements possibles', tone: 'text-warning' },
  NONE: { text: 'Aucun mouvement bancaire trouvé', tone: 'text-ink-faint' },
};

export function PaymentAnomalyRow({ anomaly }: { anomaly: PaymentAnomaly }) {
  const tier = MATCH_TIER_LABEL[anomaly.matchTier];
  return (
    <Link
      to={`/factures?invoice=${anomaly.invoiceId}`}
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:border-accent-soft hover:bg-accent-soft/30"
    >
      <div>
        <div className="text-[13px] font-medium text-ink">
          Facture n° {anomaly.invoiceNumber} — {anomaly.clientName}
        </div>
        <div className={['text-[11px]', tier.tone].join(' ')}>{tier.text}</div>
      </div>
      <div className="text-right">
        <div className="text-[14px] font-semibold tabular-nums text-ink">
          {formatMoneyFr(anomaly.totalTTC)}
        </div>
        <div className="text-[10.5px] text-ink-faint">{anomaly.daysOverdue} jours de retard</div>
      </div>
    </Link>
  );
}
