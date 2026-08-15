import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { TrialBalanceAccount } from './trial-balance-engine';

/**
 * The classification machinery behind every 2050-series line (and,
 * later, 2033-series): regime-agnostic, reused by both bilan-2050.ts and
 * compte-resultat-2052-2053.ts. See
 * specs/liasse-2050-implementation-spec.md §3/§4 for where these rules
 * come from and what's deliberately left unmapped.
 */

export type LineDirection = 'debit' | 'credit';

export interface LineRule {
  code: string;
  label: string;
  /** Account-number prefixes (startsWith match) this rule captures. */
  prefixes: string[];
  /**
   * The line's own sign convention: 'debit' sums (debit − credit) across
   * every matched account, 'credit' sums (credit − debit). Applying the
   * SAME convention uniformly to every account assigned to a line is what
   * makes a contra-account (e.g. 6091 "rabais obtenus" feeding the same
   * line as 601 "achats") net out correctly without any special-casing:
   * a credit-normal contra account naturally contributes a negative
   * amount under a 'debit' line's formula, and vice versa.
   */
  direction: LineDirection;
  /**
   * Most lines must never go negative — a negative result almost always
   * means an account was misclassified or an unexpected posting occurred,
   * and per this codebase's "throw rather than guess" rule that should
   * surface loudly. A few lines are legitimately signed in real
   * accounting (report à nouveau débiteur, déstockage) — those set this
   * to true.
   */
  allowNegative?: boolean;
}

/**
 * Accounts whose bilan placement depends on their OWN net balance sign,
 * not a fixed line — e.g. a bank account is an actif (disponibilités)
 * when in credit... no, when in DEBIT (money in the bank), and a passif
 * (dette) when in CREDIT (overdrawn). Confirmed against the 2051 form's
 * own memo line EH for the bank case — see
 * specs/liasse-2050-implementation-spec.md §4.1.
 */
export interface DualNatureRule {
  prefixes: string[];
  /** Line to route this account's balance to when it's a net debit. */
  debitLine: string;
  /** Line to route this account's balance to when it's a net credit. */
  creditLine: string;
}

function matchingRules(accountNumber: string, rules: LineRule[]): LineRule[] {
  return rules.filter((rule) => rule.prefixes.some((prefix) => accountNumber.startsWith(prefix)));
}

function matchingDualNatureRule(
  accountNumber: string,
  dualNatureRules: DualNatureRule[],
): DualNatureRule | undefined {
  return dualNatureRules.find((rule) =>
    rule.prefixes.some((prefix) => accountNumber.startsWith(prefix)),
  );
}

/**
 * Classifies ONE account (by number) into exactly one line's code —
 * the same prefix-matching and dual-nature resolution classifyAccounts
 * uses internally per account, exposed standalone for anything needing
 * a per-account, non-aggregated lookup (e.g. tableau-2057.ts's maturity
 * split, which needs to know which Cadre A/B code a raw EcritureLigne's
 * account belongs to before it's ever aggregated into a
 * TrialBalanceAccount). Throws — never guesses — on zero or multiple
 * matches, same discipline as classifyAccounts itself.
 *
 * Dual-nature accounts need the account's OWN balance sign to resolve
 * (see DualNatureRule), so `balance` is required — pass the specific
 * ligne's own debit/credit-derived amount when classifying a raw ligne
 * rather than an aggregated account.
 */
export function resolveLineCode(
  accountNumber: string,
  balance: Money,
  rules: LineRule[],
  dualNatureRules: DualNatureRule[] = [],
): string {
  const dualNature = matchingDualNatureRule(accountNumber, dualNatureRules);
  if (dualNature) {
    return balance.isPositive() ? dualNature.debitLine : dualNature.creditLine;
  }

  const matches = matchingRules(accountNumber, rules);
  if (matches.length === 0) {
    throw new BadRequestException(
      `Account "${accountNumber}" has no liasse line mapping. This account either falls outside the ` +
        'ranges this app maps (see specs/liasse-2050-implementation-spec.md §4 for what is ' +
        "deliberately deferred), or is a genuinely new account the mapping hasn't been extended to " +
        'cover — either way, this must be resolved explicitly rather than silently dropped or guessed.',
    );
  }
  if (matches.length > 1) {
    throw new ConflictException(
      `Account "${accountNumber}" matches more than one liasse line ` +
        `(${matches.map((m) => m.code).join(', ')}) — the mapping's prefix rules overlap for this ` +
        'account and must be disjoint. This is a mapping bug, not a data problem.',
    );
  }
  return matches[0].code;
}

/**
 * Classifies every account in a trial balance into exactly one line,
 * summing each line's contribution per its own sign convention. Throws
 * — never guesses — when an account matches no rule, matches more than
 * one rule, or nets to a sign its line doesn't allow.
 */
export function classifyAccounts(
  accounts: TrialBalanceAccount[],
  rules: LineRule[],
  dualNatureRules: DualNatureRule[] = [],
): Map<string, Money> {
  const totals = new Map<string, Money>();
  const contribute = (code: string, amount: Money) => {
    totals.set(code, (totals.get(code) ?? Money.zero()).plus(amount));
  };

  for (const account of accounts) {
    const dualNature = matchingDualNatureRule(account.accountNumber, dualNatureRules);
    if (dualNature) {
      if (account.balance.isPositive()) {
        contribute(dualNature.debitLine, account.balance);
      } else {
        contribute(dualNature.creditLine, account.balance.times(-1));
      }
      continue;
    }

    const matches = matchingRules(account.accountNumber, rules);
    if (matches.length === 0) {
      throw new BadRequestException(
        `Account "${account.accountNumber}" (PCG class ${account.pcgClass}) has no liasse line mapping. ` +
          'This account either falls outside the ranges this app maps (see ' +
          'specs/liasse-2050-implementation-spec.md §4 for what is deliberately deferred), or is a ' +
          "genuinely new account the mapping hasn't been extended to cover — either way, this must be " +
          'resolved explicitly rather than silently dropped or guessed.',
      );
    }
    if (matches.length > 1) {
      throw new ConflictException(
        `Account "${account.accountNumber}" matches more than one liasse line ` +
          `(${matches.map((m) => m.code).join(', ')}) — the mapping's prefix rules overlap for this ` +
          'account and must be disjoint. This is a mapping bug, not a data problem.',
      );
    }

    const rule = matches[0];
    const contribution = rule.direction === 'debit' ? account.balance : account.balance.times(-1);
    contribute(rule.code, contribution);
  }

  for (const rule of rules) {
    const amount = totals.get(rule.code) ?? Money.zero();
    if (!rule.allowNegative && amount.isNegative()) {
      throw new ConflictException(
        `Ligne ${rule.code} (${rule.label}) computed as ${amount.toApiString()}, which is negative — ` +
          'this line is not expected to ever go negative. This usually means an account was ' +
          "assigned the wrong direction, or a company's ledger genuinely has an unusual posting that " +
          'needs review before a liasse can be produced.',
      );
    }
    totals.set(rule.code, amount);
  }

  return totals;
}
