import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import {
  AssetColumnContribution,
  ImmobilisationMovementAsset,
  ROWS_2054,
  classifyAssetContributions,
  computeTableau2054,
} from './tableau-2054';

/**
 * Traceability drill-down, Tier 2 — 2054 (immobilisations, valeur
 * brute movement). See CLAUDE.md "Traceability drill-down" and
 * `tableau-2054.ts`'s own `classifyAssetContributions()` doc comment —
 * this module is the reverse-trace wiring around that shared primitive,
 * never a separately-written classification.
 *
 * One real design decision, stated here rather than left implicit:
 * the "début" column's detail stops at the asset level, with NO
 * further "→ écritures" hop offered — unlike "acquisitions"/"cessions"
 * (dated within the reported fiscal year by construction), a "début"
 * asset's own acquisition écriture is dated in a PRIOR fiscal year that
 * isn't recorded anywhere on `FixedAsset` (no `acquisitionFiscalYearId`
 * field exists). Guessing a fiscal year from `acquisitionDate` alone
 * would risk showing the wrong year's écritures if the guess is wrong,
 * so this pass simply doesn't offer that hop for "début" — the asset
 * list itself (which DOES tie to the line via the oracle below) is the
 * honest bottom of that particular chain. "Fin" is never traceable at
 * all — always derived (début + acquisitions − cessions), same
 * non-clickable-subtotal convention as Tier 1's CdrTotalRow/bilan's DI.
 */

export type Tableau2054TraceColumn = 'debut' | 'acquisitions' | 'cessions';

/** A FixedAsset enriched with the real ids the pure classifier doesn't need but the trace response does. */
export interface ImmobilisationMovementAssetWithId extends ImmobilisationMovementAsset {
  assetId: string;
  assetLabel: string;
  accountId: string;
  accountLabel: string;
}

export interface Tableau2054AssetTrace {
  assetId: string;
  assetLabel: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  contribution: string;
}

export interface Tableau2054TraceResult {
  rowCode: string;
  rowLabel: string;
  column: Tableau2054TraceColumn;
  columnValue: string;
  fiscalYearId: string;
  /**
   * Honest per this module's own doc comment above: false only for
   * "debut", where no fiscal-year-safe écriture hop exists to offer.
   */
  drillableToEcritures: boolean;
  assets: Tableau2054AssetTrace[];
}

/**
 * Pure computation, no I/O. `assets` must be the SAME list (enriched
 * with ids) the caller already fetched to compute the forward 2054 —
 * see `liasse.service.ts`'s `traceTableau2054()` for the real wiring.
 */
export function traceTableau2054Column(
  assets: ImmobilisationMovementAssetWithId[],
  fiscalYear: { id: string; startDate: Date; endDate: Date },
  rowCode: string,
  column: Tableau2054TraceColumn,
): Tableau2054TraceResult {
  const row = ROWS_2054.find((r) => r.code === rowCode);
  if (!row) {
    throw new BadRequestException(
      `La ligne 2054 "${rowCode}" n'est pas traçable — code de catégorie inconnu.`,
    );
  }
  const categorySet = new Set(row.categories);

  const traced: Tableau2054AssetTrace[] = [];
  const contributions: Money[] = [];
  for (const asset of assets) {
    const assetContributions: AssetColumnContribution[] = classifyAssetContributions(
      asset,
      fiscalYear,
    );
    for (const c of assetContributions) {
      if (c.column !== column || !categorySet.has(c.categoryCode)) continue;
      traced.push({
        assetId: asset.assetId,
        assetLabel: asset.assetLabel,
        accountId: asset.accountId,
        accountNumber: asset.accountNumber,
        accountLabel: asset.accountLabel,
        contribution: c.contribution.toApiString(),
      });
      contributions.push(c.contribution);
    }
  }

  // Independent second derivation — re-run the FULL forward computation and read the report's own
  // value for this exact (row, column) cell, exactly the "two genuinely separate derivations, not
  // the same call checked against itself" discipline Tier 1's assertLineTraceabilitySums() used.
  const forward = computeTableau2054(assets, fiscalYear);
  const ligne = forward.lignes.find((l) => l.code === rowCode);
  if (!ligne) {
    throw new BadRequestException(`La ligne 2054 "${rowCode}" n'est pas traçable.`);
  }
  const officialValue = Money.fromString(
    column === 'debut'
      ? ligne.valeurBruteDebut
      : column === 'acquisitions'
        ? ligne.acquisitions
        : ligne.cessions,
  );
  const summed = contributions.reduce((sum, c) => sum.plus(c), Money.zero());
  if (!summed.equals(officialValue)) {
    throw new ConflictException(
      `Traçabilité rompue pour 2054 ${rowCode}/${column} : détail = ${summed.toApiString()}, ` +
        `ligne officielle = ${officialValue.toApiString()}.`,
    );
  }

  return {
    rowCode,
    rowLabel: row.label,
    column,
    columnValue: officialValue.toApiString(),
    fiscalYearId: fiscalYear.id,
    drillableToEcritures: column !== 'debut',
    assets: traced,
  };
}
