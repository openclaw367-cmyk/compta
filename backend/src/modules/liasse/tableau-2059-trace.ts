import { BadRequestException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { CESSION_ACCOUNTS, resolveCessionNature } from '../depreciation/cession-invariants';

/**
 * Traceability drill-down, Tier 3 — 2059-A (plus/moins-values). See
 * CLAUDE.md "Traceability drill-down" and "Immobilisations / cession".
 *
 * Structurally different from every other trace tier: a 2059-A row is
 * ALREADY asset-level (one row per disposed asset, never a category
 * aggregate), so there is no "list of contributing items" to build —
 * each traceable column resolves to exactly ONE account. The oracle is
 * correspondingly simple: that one account's own contribution already
 * equals the reported figure by construction (both come from the same
 * `computeFixedAssetSummary()`/cession fields), so there's no separate
 * "sum vs. official total" check the way category-aggregate tiers
 * needed — the real content here is resolving the RIGHT account,
 * reusing `resolveCessionNature()` (the exact same forward primitive
 * `DepreciationService.disposeFixedAsset()` used to decide which 775x
 * account to credit), never guessing or re-deriving separately.
 *
 * All three columns are dated within the reported fiscal year by
 * construction (`computeTableau2059A()` already asserts every disposal
 * falls inside it) — so, unlike 2054's own "début" column, every
 * column here CAN offer a real "→ écritures" hop, scoped to (account,
 * reportedFiscalYear).
 */

export type Tableau2059TraceColumn = 'valeurOrigine' | 'amortissements' | 'prixDeVente';

export interface Tableau2059TraceResult {
  assetId: string;
  column: Tableau2059TraceColumn;
  columnValue: string;
  accountNumber: string;
}

/**
 * Pure — no I/O. `grossAccountNumber`/`depreciationAccountNumber` come
 * straight from the same `FixedAsset` row `computeTableau2059A()`'s own
 * input was built from; `produitAccountNumber` is resolved via
 * `resolveCessionNature()` below, not passed in, since it's derivable
 * without a query.
 */
export function traceTableau2059Column(
  assetId: string,
  grossAccountNumber: string,
  depreciationAccountNumber: string,
  valeurOrigine: Money,
  amortissements: Money,
  prixDeVente: Money,
  column: Tableau2059TraceColumn,
): Tableau2059TraceResult {
  if (column === 'valeurOrigine') {
    return {
      assetId,
      column,
      columnValue: valeurOrigine.toApiString(),
      accountNumber: grossAccountNumber,
    };
  }
  if (column === 'amortissements') {
    return {
      assetId,
      column,
      columnValue: amortissements.toApiString(),
      accountNumber: depreciationAccountNumber,
    };
  }
  if (column === 'prixDeVente') {
    const nature = resolveCessionNature(grossAccountNumber);
    return {
      assetId,
      column,
      columnValue: prixDeVente.toApiString(),
      accountNumber: CESSION_ACCOUNTS[nature].produit,
    };
  }
  throw new BadRequestException(`La colonne 2059-A "${String(column)}" n'est pas traçable.`);
}
