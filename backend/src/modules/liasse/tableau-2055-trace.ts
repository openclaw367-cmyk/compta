import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { IMMOBILISATION_CATEGORIES } from './immobilisation-categories';
import {
  ImmobilisationDepreciationMovement,
  ImmobilisationDisposal,
  classifyDepreciationEntry,
  classifyDisposal,
  computeTableau2055,
} from './tableau-2055';

/**
 * Traceability drill-down, Tier 2 — 2055 (amortissements movement). See
 * CLAUDE.md "Traceability drill-down" and `tableau-2055.ts`'s own
 * `classifyDepreciationEntry()`/`classifyDisposal()` doc comment.
 *
 * Unlike 2054's "début" (see that module's own trace file doc
 * comment), 2055's "début" IS fully drillable to real écritures —
 * `DepreciationEntry.fiscalYearId` is a real, stored field, never
 * guessed, so each prior-year contribution carries its OWN correct
 * fiscal year for the écriture hop, not the reported year. "Diminutions"
 * (a disposed asset's full cumulative amortissements, per
 * `computeFixedAssetSummary()`'s own definition — literally the sum of
 * that asset's own posted DepreciationEntry amounts, reused verbatim
 * here, never re-derived) is scoped to the REPORTED fiscal year for its
 * own écriture hop — the disposal itself (which is what actually zeroes
 * this account out) is dated within the reported year by construction
 * (2054/2055's own disposal list is already date-filtered upstream).
 * That hop honestly shows THIS year's own écritures on the asset's
 * depreciation account (the final prorated dotation + the disposal
 * écriture itself) — it does not claim to show every historical
 * écriture behind the full cumulative figure, which would need a
 * multi-year view this pass doesn't build.
 */

export type Tableau2055TraceColumn = 'debut' | 'dotations' | 'diminutions';

export interface ImmobilisationDepreciationMovementWithId extends ImmobilisationDepreciationMovement {
  entryId: string;
  assetId: string;
  assetLabel: string;
  /**
   * The asset's 28x contra-account — deliberately NOT the same account
   * `accountNumber` (inherited from the base interface) names, which
   * stays the asset's own 21x/20x GROSS account (needed only for
   * `resolveImmobilisationCategory()`'s classification). Dotations
   * post to THIS account, never the gross one — see module doc
   * comment.
   */
  depreciationAccountId: string;
  depreciationAccountNumber: string;
  depreciationAccountLabel: string;
}

export interface ImmobilisationDisposalWithId extends ImmobilisationDisposal {
  assetId: string;
  assetLabel: string;
  depreciationAccountId: string;
  depreciationAccountNumber: string;
  depreciationAccountLabel: string;
}

export interface Tableau2055DetailTrace {
  assetId: string;
  assetLabel: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** The real fiscal year this specific contribution's own écriture is dated in — see module doc comment. */
  fiscalYearId: string;
  contribution: string;
}

export interface Tableau2055TraceResult {
  categoryCode: string;
  categoryLabel: string;
  column: Tableau2055TraceColumn;
  columnValue: string;
  details: Tableau2055DetailTrace[];
}

export function traceTableau2055Column(
  entries: ImmobilisationDepreciationMovementWithId[],
  disposals: ImmobilisationDisposalWithId[],
  reportedFiscalYear: { id: string; endDate: Date },
  categoryCode: string,
  column: Tableau2055TraceColumn,
): Tableau2055TraceResult {
  const category = IMMOBILISATION_CATEGORIES.find((c) => c.code === categoryCode);
  if (!category || category.label2055 === '') {
    throw new BadRequestException(
      `La ligne 2055 "${categoryCode}" n'est pas traçable — cette catégorie n'a pas de ligne 2055 ` +
        '(en cours, avances, et financières ne sont jamais amorties).',
    );
  }

  const details: Tableau2055DetailTrace[] = [];
  const contributions: Money[] = [];

  if (column === 'diminutions') {
    for (const disposal of disposals) {
      const c = classifyDisposal(disposal);
      if (c.categoryCode !== categoryCode) continue;
      details.push({
        assetId: disposal.assetId,
        assetLabel: disposal.assetLabel,
        accountId: disposal.depreciationAccountId,
        accountNumber: disposal.depreciationAccountNumber,
        accountLabel: disposal.depreciationAccountLabel,
        fiscalYearId: reportedFiscalYear.id,
        contribution: c.contribution.toApiString(),
      });
      contributions.push(c.contribution);
    }
  } else {
    for (const entry of entries) {
      const c = classifyDepreciationEntry(entry, reportedFiscalYear);
      if (c.categoryCode !== categoryCode || c.column !== column) continue;
      details.push({
        assetId: entry.assetId,
        assetLabel: entry.assetLabel,
        accountId: entry.depreciationAccountId,
        accountNumber: entry.depreciationAccountNumber,
        accountLabel: entry.depreciationAccountLabel,
        fiscalYearId: entry.fiscalYearId,
        contribution: c.contribution.toApiString(),
      });
      contributions.push(c.contribution);
    }
  }

  // Independent second derivation, same discipline as tableau-2054-trace.ts.
  const forward = computeTableau2055(entries, reportedFiscalYear, disposals);
  const ligne = forward.lignes.find((l) => l.code === categoryCode);
  if (!ligne) {
    throw new BadRequestException(`La ligne 2055 "${categoryCode}" n'est pas traçable.`);
  }
  const officialValue = Money.fromString(
    column === 'debut'
      ? ligne.montantDebut
      : column === 'dotations'
        ? ligne.dotations
        : ligne.diminutions,
  );
  const summed = contributions.reduce((sum, c) => sum.plus(c), Money.zero());
  if (!summed.equals(officialValue)) {
    throw new ConflictException(
      `Traçabilité rompue pour 2055 ${categoryCode}/${column} : détail = ${summed.toApiString()}, ` +
        `ligne officielle = ${officialValue.toApiString()}.`,
    );
  }

  return {
    categoryCode,
    categoryLabel: category.label2055,
    column,
    columnValue: officialValue.toApiString(),
    details,
  };
}
