import type { Account } from '../api/types';

/**
 * 401 fournisseurs / 411 clients — the collectifs that accept a tiers
 * (compte auxiliaire) breakdown. Mirrors the backend's identically-named
 * check (backend/src/modules/accounts/accounts.service.ts) — only types
 * cross the frontend/backend boundary in this project, not runtime code,
 * so this one duplication is structural. Shared across frontend files
 * (EcritureEditor, TiersPage) so it isn't duplicated *within* the
 * frontend too.
 */
export function isAuxiliaryBearingAccount(account: Account): boolean {
  return account.number.startsWith('401') || account.number.startsWith('411');
}
