import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';

/**
 * Regime-independent aggregation layer — see
 * specs/liasse-2050-implementation-spec.md §6. Shared by the 2050-series
 * mapping (bilan-2050.ts, compte-resultat-2052-2053.ts) and, later, the
 * 2033-series mapping, without either knowing about the other.
 */

export interface LiasseLigne {
  compteNumber: string;
  pcgClass: number;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

export interface TrialBalanceAccount {
  accountNumber: string;
  pcgClass: number;
  /** debit − credit for the account, across every matched ligne. Positive = net debit, negative = net credit. */
  balance: Money;
}

/**
 * Aggregates already-fetched, period-scoped, validated-only ledger lines
 * into one balance per account. Accounts that net to exactly zero are
 * dropped — an account with no real activity in the period needs no
 * bilan/compte-de-résultat line, and keeping it out avoids a spurious
 * "unmapped account" throw downstream for an account nobody actually
 * used this period.
 */
export function buildTrialBalance(lignes: LiasseLigne[]): TrialBalanceAccount[] {
  const byAccount = new Map<string, { pcgClass: number; debit: Money; credit: Money }>();
  for (const ligne of lignes) {
    const entry = byAccount.get(ligne.compteNumber) ?? {
      pcgClass: ligne.pcgClass,
      debit: Money.zero(),
      credit: Money.zero(),
    };
    entry.debit = entry.debit.plus(Money.fromDecimal(ligne.debit));
    entry.credit = entry.credit.plus(Money.fromDecimal(ligne.credit));
    byAccount.set(ligne.compteNumber, entry);
  }

  const accounts: TrialBalanceAccount[] = [];
  for (const [accountNumber, { pcgClass, debit, credit }] of byAccount) {
    const balance = debit.minus(credit);
    if (balance.isZero()) {
      continue;
    }
    accounts.push({ accountNumber, pcgClass, balance });
  }
  return accounts;
}
