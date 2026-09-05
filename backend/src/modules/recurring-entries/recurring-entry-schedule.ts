import { RecurrenceFrequency } from '@prisma/client';

/**
 * Purely informational — feeds the templates list's "prochaine échéance"
 * hint. Never drives auto-posting: applying a template is always an
 * explicit human action (see CLAUDE.md "Recurring entries / templates").
 *
 * QUARTERLY assumes calendar-quarter alignment (Jan-Mar, Apr-Jun, Jul-Sep,
 * Oct-Dec) — the same convention this app's own VAT declarations use for
 * quarterly filing — with `anchorMonth` (1-3) selecting the month within
 * that quarter. YEARLY uses `anchorMonth` (1-12) as the absolute calendar
 * month. `anchorDay` beyond the target month's own length (e.g. 31 in
 * February) clamps to that month's last day rather than overflowing into
 * the next month.
 *
 * Returns null when `frequency`/`anchorDay` (or `anchorMonth`, for
 * QUARTERLY/YEARLY) are unset — a template with no recurrence info simply
 * has no "next due" hint to show.
 */
export function computeNextDueDate(
  frequency: RecurrenceFrequency | null,
  anchorDay: number | null,
  anchorMonth: number | null,
  lastAppliedAt: Date | null,
  today: Date,
): string | null {
  if (!frequency || !anchorDay) return null;
  if (frequency !== 'MONTHLY' && !anchorMonth) return null;

  const day = anchorDay;
  const monthOffset = frequency === 'MONTHLY' ? 0 : (anchorMonth as number) - 1;
  const step = frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : 12;
  const todayOnly = dateOnly(today);

  function periodStart(date: Date): { year: number; monthIndex: number } {
    const year = date.getFullYear();
    const month = date.getMonth();
    if (frequency === 'MONTHLY') return { year, monthIndex: month };
    if (frequency === 'QUARTERLY') return { year, monthIndex: Math.floor(month / 3) * 3 };
    return { year, monthIndex: 0 };
  }

  function candidateFor(period: { year: number; monthIndex: number }): Date {
    const month = period.monthIndex + monthOffset;
    const lastDayOfMonth = new Date(period.year, month + 1, 0).getDate();
    return new Date(period.year, month, Math.min(day, lastDayOfMonth));
  }

  function advance(period: { year: number; monthIndex: number }): {
    year: number;
    monthIndex: number;
  } {
    const flatMonthIndex = period.year * 12 + period.monthIndex + step;
    return { year: Math.floor(flatMonthIndex / 12), monthIndex: flatMonthIndex % 12 };
  }

  let period = periodStart(lastAppliedAt ? dateOnly(lastAppliedAt) : todayOnly);
  let candidate = candidateFor(period);

  if (lastAppliedAt) {
    // Always the period AFTER the one it was last applied in — a
    // template is expected to apply once per period.
    period = advance(period);
    candidate = candidateFor(period);
  } else if (candidate < todayOnly) {
    period = advance(period);
    candidate = candidateFor(period);
  }

  return toIsoDate(candidate);
}

function dateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
