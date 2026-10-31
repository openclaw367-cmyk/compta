import { Money } from '../../common/decimal';

/**
 * Budgeting / forecasting vs. actuals — roadmap item 2c. Pure compute
 * layer: zero Prisma/DB access, independently unit-testable (see
 * budgeting.spec.ts). `BudgetingService.compareToActual()` is the thin
 * wrapper that fetches a Budget's own lines plus the real ledger
 * actuals and feeds them into `computeBudgetVariance()` below — same
 * "pure function tested standalone, thin service wrapper tested
 * separately" split as most other modules in this app (e.g.
 * cash-flow-statement.ts / CashFlowService, ca3-declaration.ts /
 * VatService).
 *
 * **Which existing primitive this reuses for "actual" — a deliberate
 * deviation from the roadmap's own first sketch, documented here per
 * this app's own established discipline (see CLAUDE.md "Invoicing —
 * related écritures" for the precedent of recording such a deviation,
 * not for any of that section's actual content).** The roadmap text
 * for 2c says "reusing `trial-balance-engine.ts` verbatim for the
 * actual column." Reading both before committing: `trial-balance-
 * engine.ts`'s `buildTrialBalance()` is a lower-level pure function
 * that `LiasseService` feeds pre-filtered, VALIDATED-ONLY ledger lines
 * into so it can classify each account into exactly one compliance
 * line (bilan/CDR) — a different purpose (classification), and it
 * silently DROPS any account whose balance nets to exactly zero (fine
 * for liasse line-mapping, wrong here: a budgeted account with zero
 * actual activity so far is real, useful "0,00 so far" information for
 * a variance report, not a row to omit). `LedgerService.trialBalance()`
 * (`src/modules/ledger/ledger.service.ts`), by contrast, already
 * returns exactly the shape this report needs —
 * `{accountId, accountNumber, accountLabel, totalDebit, totalCredit,
 * balance}` per account, scoped by fiscal year (and optionally a
 * period) — already has its own controller endpoint, already tested,
 * and (like every other report in this app) includes draft écritures
 * alongside validated ones, which is the right default for a
 * day-to-day budget-tracking tool, not a compliance artifact.
 * `BudgetingService` therefore reuses `LedgerService.trialBalance()`
 * directly, not `trial-balance-engine.ts`.
 *
 * **Sign convention for "actual" — stated explicitly, not guessed per
 * PCG class.** `plannedAmount` is captured as a non-negative magnitude
 * (same `@IsMoneyString()` validator every other money DTO field in
 * this app already uses — no new, signed-money variant was introduced)
 * in the account's own natural reporting sense: "how much do you plan
 * to spend" for a debit-normal account (e.g. a class-6 charge), "how
 * much do you plan to bring in" for a credit-normal account (e.g. a
 * class-7 produit). Rather than hand-coding which PCG classes are
 * debit-normal vs. credit-normal (class 4/5 are genuinely dual-nature —
 * see liasse-line-rules.ts's own `DualNatureRule`s — so a blanket
 * per-class flip would risk silently guessing wrong for exactly the
 * accounts that are hardest to get right), `actualAmount` here is the
 * ABSOLUTE VALUE of `LedgerService.trialBalance()`'s own signed
 * `balance` (debit − credit). This needs no PCG-class knowledge at all:
 * in ordinary operation a charge account nets to a positive balance
 * (debit-heavy) and a produit account nets to a negative one
 * (credit-heavy), so taking the magnitude naturally lines both up with
 * a plain, non-negative planned figure. **Stated limitation, not a
 * silent gap**: this means the report compares MAGNITUDES, not signed
 * values — an account that unusually nets to the "wrong" side this
 * period (e.g. a produit account with heavy credit notes landing it on
 * a net debit) would still report as ordinary "actual activity" rather
 * than flagging that the direction itself was wrong. Documented here
 * and on the report's own honesty banner, not hidden.
 *
 * **The honesty boundary, stated per the roadmap's own instruction**:
 * the variance ARITHMETIC (subtraction, a percentage) is fully
 * verifiable, and the actual column is a pure regression check against
 * the already-verified `LedgerService.trialBalance()` (not a new
 * oracle) — but the budget number itself has no correctness standard
 * to verify against. It's a business input, not a derived accounting
 * fact, so "verified" here only ever means "the tool computed the
 * comparison correctly against whatever figures a human entered," never
 * "the budget is right." Same discipline as the résultat fiscal
 * module's own honesty banner (CLAUDE.md "Détermination du résultat
 * fiscal") — quoted, not re-derived, on the frontend's own banner.
 */

export interface BudgetVarianceLineInput {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** Money string, non-negative — see this file's own doc comment for the sign convention. */
  plannedAmount: string;
}

/** One account's real ledger balance for the same fiscal year — shaped exactly like
 *  `TrialBalanceLineDto`, the subset this module actually needs. */
export interface ActualAccountBalance {
  accountId: string;
  /** debit - credit, signed, exactly as LedgerService.trialBalance() returns it. */
  balance: string;
}

export interface BudgetVarianceLine {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** Money string, non-negative, as entered. */
  plannedAmount: string;
  /** Money string, non-negative — |trialBalance.balance| for this account; "0.00" when the
   *  account has no ledger activity in scope at all (never omitted — unlike
   *  trial-balance-engine.ts's buildTrialBalance(), a budgeted account with zero actual
   *  activity so far is itself real information for this report). */
  actualAmount: string;
  /** actual − budget. Positive = more activity than planned (overspend/over-revenue in
   *  magnitude terms); negative = less than planned. */
  variance: string;
  /** variance / budget × 100, 2-decimal string — `null` ("n/a") when plannedAmount is
   *  exactly "0.00", never a divide-by-zero. Same convention as financial-analysis.ts's own
   *  cost-of-debt guard: "money is discretized to the centime in this app, so there is no
   *  meaningful near-zero-but-not-exactly-zero case to guard separately." */
  variancePercent: string | null;
}

export interface BudgetVarianceTotals {
  plannedAmount: string;
  actualAmount: string;
  variance: string;
  variancePercent: string | null;
}

export interface BudgetVarianceReport {
  budgetId: string;
  budgetLabel: string;
  fiscalYearId: string;
  lines: BudgetVarianceLine[];
  totals: BudgetVarianceTotals;
}

function variancePercentOrNull(variance: Money, planned: Money): string | null {
  if (planned.isZero()) {
    return null;
  }
  return variance.toDecimal().dividedBy(planned.toDecimal()).times(100).toFixed(2);
}

function absMoney(value: Money): Money {
  return value.isNegative() ? Money.zero().minus(value) : value;
}

/**
 * Pure arithmetic — no I/O. `lines` are a Budget's own `BudgetLine`s (one per budgeted
 * account); `actuals` are the matching accounts' real ledger balances for the same fiscal
 * year (from `LedgerService.trialBalance()`). An account with no matching actual (no ledger
 * activity in scope) reports "0.00", not an omission.
 */
export function computeBudgetVariance(
  lines: BudgetVarianceLineInput[],
  actuals: ActualAccountBalance[],
): BudgetVarianceLine[] {
  const actualByAccount = new Map(actuals.map((a) => [a.accountId, Money.fromString(a.balance)]));

  return lines.map((line) => {
    const planned = Money.fromString(line.plannedAmount);
    const rawActual = actualByAccount.get(line.accountId) ?? Money.zero();
    const actual = absMoney(rawActual);
    const variance = actual.minus(planned);
    return {
      accountId: line.accountId,
      accountNumber: line.accountNumber,
      accountLabel: line.accountLabel,
      plannedAmount: planned.toApiString(),
      actualAmount: actual.toApiString(),
      variance: variance.toApiString(),
      variancePercent: variancePercentOrNull(variance, planned),
    };
  });
}

/** Sums every line's own column independently — never re-derives a line from the totals. */
export function computeBudgetVarianceTotals(lines: BudgetVarianceLine[]): BudgetVarianceTotals {
  let totalPlanned = Money.zero();
  let totalActual = Money.zero();
  for (const line of lines) {
    totalPlanned = totalPlanned.plus(Money.fromString(line.plannedAmount));
    totalActual = totalActual.plus(Money.fromString(line.actualAmount));
  }
  const totalVariance = totalActual.minus(totalPlanned);
  return {
    plannedAmount: totalPlanned.toApiString(),
    actualAmount: totalActual.toApiString(),
    variance: totalVariance.toApiString(),
    variancePercent: variancePercentOrNull(totalVariance, totalPlanned),
  };
}
