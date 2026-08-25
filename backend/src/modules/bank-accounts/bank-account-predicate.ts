/**
 * Which PCG accounts a BankAccount may be linked to — the exact same
 * prefix family `liasse-line-rules.ts`'s own DualNatureRule already
 * treats as "banking" (512 Banques, 514 Chèques postaux, 516 VMP
 * assimilables à des disponibilités, 517 Autres disponibilités) —
 * see CLAUDE.md "Bank reconciliation". Only 512/514 are seeded by
 * PCG_ACCOUNTS today, but the predicate covers the full family a
 * company might still create by hand.
 */
export function isBankAccount(account: { number: string; pcgClass: number }): boolean {
  return account.pcgClass === 5 && /^51[2467]/.test(account.number);
}
