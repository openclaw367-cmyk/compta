import { Money } from '../../common/decimal';

/**
 * HIGH = exactly one unmatched bank movement's amount equals this
 * invoice's own TTC within the date window — a one-glance "go reconcile
 * it" suggestion. AMBIGUOUS = 2+ candidates. NONE = no bank movement
 * found at all — still a real flag ("overdue, unreconciled"), just
 * without an actionable suggestion attached. Same three-tier shape as
 * bank-reconciliation/matching-engine.ts's `MatchConfidence`.
 */
export type PaymentMatchTier = 'HIGH' | 'AMBIGUOUS' | 'NONE';

export interface OpenInvoiceInput {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  totalTTC: Money;
  invoiceDate: Date;
}

/** A thin, Prisma-independent shape — mirrors matching-engine.ts's own `MatchableStatementLine`. */
export interface UnmatchedStatementLineInput {
  id: string;
  /** Signed — positive = inflow, matching Company money going INTO the bank account (a client payment). */
  amount: Money;
  bookingDate: Date;
  bankAccountLabel: string;
}

export interface PaymentMatchCandidate {
  statementLineId: string;
  amount: string;
  /** YYYY-MM-DD */
  bookingDate: string;
  bankAccountLabel: string;
  dateDistanceDays: number;
}

export interface PaymentAnomaly {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  totalTTC: string;
  /** YYYY-MM-DD */
  invoiceDate: string;
  daysOverdue: number;
  matchTier: PaymentMatchTier;
  /** Empty for NONE; exactly one for HIGH; 2+ for AMBIGUOUS, ranked closest-date-first. */
  candidates: PaymentMatchCandidate[];
}

/**
 * An invoice becomes eligible for this flag once it's this many days
 * past its own invoiceDate — a grace period so a just-issued invoice
 * isn't immediately nagged about. A bank movement is only considered a
 * candidate match within this window around invoiceDate: a few days
 * before (an early/advance payment) through several weeks after
 * (typical payment terms). All three provisional, same "revisit against
 * real data" framing as bank-reconciliation's own DATE_WINDOW_DAYS.
 */
export const OVERDUE_GRACE_DAYS = 30;
export const MATCH_WINDOW_DAYS_BEFORE = 5;
export const MATCH_WINDOW_DAYS_AFTER = 60;

/** Exported so classifyInvoicePaymentStatus() below reuses the exact same day-math, not a re-derivation. */
export function signedDaysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((a.getTime() - b.getTime()) / msPerDay);
}

export type InvoicePaymentStatus = 'PAID' | 'OPEN' | 'OVERDUE';

/**
 * Promotes this module's own grace-period/lettrage logic to a per-invoice,
 * queryable property — see CLAUDE.md "Invoicing — payment status" and
 * roadmap item 1b. Reuses `OVERDUE_GRACE_DAYS` and `signedDaysBetween()`
 * verbatim rather than re-deriving the grace-period rule a second time.
 *
 * **`PARTIALLY_PAID` is deliberately NOT a state here.** `lettrage` in
 * this app is a single per-ligne flag with no amount-netting computed
 * anywhere (confirmed — grepped every `lettrage` reference in
 * `src/modules`, nothing sums a lettrage group's own balance) — a
 * genuine partial payment can't be honestly distinguished from "not
 * paid at all" without a real netting mechanism (roadmap item 1f,
 * prepayments, or a future lettrage-group-balance feature). Flagged
 * here as a stated scope boundary, same "flag, don't fake" discipline
 * as 2059-A's own court-terme/long-terme qualification staying null.
 */
export function classifyInvoicePaymentStatus(
  isLettered: boolean,
  invoiceDate: Date,
  today: Date,
): InvoicePaymentStatus {
  if (isLettered) return 'PAID';
  return signedDaysBetween(today, invoiceDate) >= OVERDUE_GRACE_DAYS ? 'OVERDUE' : 'OPEN';
}

/**
 * Pure, stateless, never persisted — same discipline as
 * bank-reconciliation/matching-engine.ts. The caller is responsible for
 * scoping `openInvoices` to FINALIZED SALE invoices whose own posted
 * écriture's client ligne is still unlettered (the only "reconciled"
 * signal this app has — there is no paid/unpaid status on Invoice
 * itself), and `unmatchedStatementLines` to this company's own
 * UNMATCHED BankStatementLine rows.
 */
export function computePaymentAnomalies(
  openInvoices: OpenInvoiceInput[],
  unmatchedStatementLines: UnmatchedStatementLineInput[],
  today: Date,
): PaymentAnomaly[] {
  const anomalies: PaymentAnomaly[] = [];

  for (const invoice of openInvoices) {
    const daysOverdue = signedDaysBetween(today, invoice.invoiceDate);
    if (daysOverdue < OVERDUE_GRACE_DAYS) continue;

    const candidates = unmatchedStatementLines
      .filter((line) => {
        if (!line.amount.equals(invoice.totalTTC)) return false;
        const signedDistance = signedDaysBetween(line.bookingDate, invoice.invoiceDate);
        return (
          signedDistance >= -MATCH_WINDOW_DAYS_BEFORE && signedDistance <= MATCH_WINDOW_DAYS_AFTER
        );
      })
      .map((line) => ({
        statementLineId: line.id,
        amount: line.amount.toApiString(),
        bookingDate: line.bookingDate.toISOString().slice(0, 10),
        bankAccountLabel: line.bankAccountLabel,
        dateDistanceDays: Math.abs(signedDaysBetween(line.bookingDate, invoice.invoiceDate)),
      }))
      .sort((a, b) => a.dateDistanceDays - b.dateDistanceDays);

    anomalies.push({
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.clientName,
      totalTTC: invoice.totalTTC.toApiString(),
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      daysOverdue,
      matchTier: candidates.length === 0 ? 'NONE' : candidates.length === 1 ? 'HIGH' : 'AMBIGUOUS',
      candidates,
    });
  }

  return anomalies.sort((a, b) => {
    if (a.matchTier === 'HIGH' && b.matchTier !== 'HIGH') return -1;
    if (b.matchTier === 'HIGH' && a.matchTier !== 'HIGH') return 1;
    return b.daysOverdue - a.daysOverdue;
  });
}
