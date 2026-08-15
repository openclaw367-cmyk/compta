/**
 * Pure predicate for the orphaned-immobilisation warning (see CLAUDE.md
 * "Known scope boundaries" — the class-2 écriture with no FixedAsset
 * behind it that the 2054/2055 liasse tie-out caught, but only at
 * liasse-generation time). Mirrors ImmobilisationsPage.tsx's own
 * asset-account filter and cession-invariants.ts's contra-account
 * rejection: class 2, excluding the 28x/29x amortissements/dépréciations
 * contra-accounts, which are never themselves "an immobilisation."
 */
export function isImmobilisationAccount(account: { number: string; pcgClass: number }): boolean {
  return account.pcgClass === 2 && !/^2[89]/.test(account.number);
}
