import { formatMoneyFr, isZeroMoney, subtractMoneyStrings } from '../../lib/money';

export function BalanceIndicator({
  totalDebit,
  totalCredit,
}: {
  totalDebit: string;
  totalCredit: string;
}) {
  const delta = subtractMoneyStrings(totalDebit, totalCredit);
  const balanced = isZeroMoney(delta);
  const empty = isZeroMoney(totalDebit) && isZeroMoney(totalCredit);

  if (empty) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12.5px] font-medium text-ink-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-faint" />
        En attente de saisie
      </span>
    );
  }

  if (balanced) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-positive-soft px-3 py-1 text-[12.5px] font-medium text-positive">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2.5 6.5 5 9l4.5-5.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Équilibrée
      </span>
    );
  }

  const absDelta = delta.startsWith('-') ? delta.slice(1) : delta;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-negative-soft px-3 py-1 text-[12.5px] font-medium text-negative tabular-nums">
      <span className="h-1.5 w-1.5 rounded-full bg-negative" />
      Écart de {formatMoneyFr(absDelta)}
    </span>
  );
}
