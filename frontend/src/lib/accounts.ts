import type { Account } from '../api/types';

/**
 * 401 fournisseurs / 411 clients / 455 associés — the collectifs that
 * accept a tiers (compte auxiliaire) breakdown. Mirrors the backend's
 * identically-named check (backend/src/modules/accounts/accounts.service.ts)
 * — only types cross the frontend/backend boundary in this project, not
 * runtime code, so this one duplication is structural. Shared across
 * frontend files (EcritureEditor, TiersPage, DashboardPage) so it isn't
 * duplicated *within* the frontend too. 455 was added 2026-08-24 for the
 * dashboard's per-associé comptes courants tile — see CLAUDE.md
 * "Dashboard".
 */
export function isAuxiliaryBearingAccount(account: Account): boolean {
  return (
    account.number.startsWith('401') ||
    account.number.startsWith('411') ||
    account.number.startsWith('455')
  );
}

/**
 * A line's TVA rate only matters for a collectée line (account 4457x) or
 * a produit line (class 7) — see computeCa3Declaration on the backend.
 * Extracted from EcritureEditor.tsx (2026-09-05) so
 * RecurringTemplateEditor can show the same "don't imply every line
 * needs a rate" gating without duplicating the predicate.
 */
export function lineNeedsVatRate(account: Account | undefined): boolean {
  return Boolean(account && (account.number.startsWith('4457') || account.pcgClass === 7));
}
