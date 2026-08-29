import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { PROVISION_CATEGORIES } from './provision-categories';
import { ProvisionMovementLigne, classifyProvisionLigne, computeTableau2056 } from './tableau-2056';

/**
 * Traceability drill-down, Tier 2 — 2056 (provisions). See CLAUDE.md
 * "Traceability drill-down" and `tableau-2056.ts`'s own
 * `classifyProvisionLigne()` doc comment.
 *
 * The simplest of the three Tier-2 annexes: unlike 2054/2055 (rooted in
 * FixedAsset/DepreciationEntry, with "début" genuinely spanning prior
 * fiscal years), EVERY 2056 column — début included — is sourced
 * directly from raw ledger lignes dated WITHIN the reported fiscal
 * year: à-nouveau posts each year's own opening balance at exactly
 * that year's `startDate` (the same structural fact CLAUDE.md's own
 * "Tableau des flux de trésorerie" section documents), so a "début"
 * ligne's écriture is honestly, always, in the SAME fiscal year being
 * reported — no per-item fiscal year resolution needed, unlike 2055.
 * This makes 2056 close to a Tier-1-shaped trace: per-account
 * aggregation, one fiscal year, hand off to `AccountLedgerDrilldown`.
 */

export type Tableau2056TraceColumn = 'debut' | 'dotations' | 'reprises';

export interface ProvisionMovementLigneWithAccount extends ProvisionMovementLigne {
  accountId: string;
  accountLabel: string;
}

export interface Tableau2056AccountTrace {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  contribution: string;
}

export interface Tableau2056TraceResult {
  categoryCode: string;
  categoryLabel: string;
  column: Tableau2056TraceColumn;
  columnValue: string;
  fiscalYearId: string;
  accounts: Tableau2056AccountTrace[];
}

export function traceTableau2056Column(
  lignes: ProvisionMovementLigneWithAccount[],
  fiscalYearId: string,
  categoryCode: string,
  column: Tableau2056TraceColumn,
): Tableau2056TraceResult {
  const category = PROVISION_CATEGORIES.find((c) => c.code === categoryCode);
  if (!category) {
    throw new BadRequestException(`La ligne 2056 "${categoryCode}" n'est pas traçable.`);
  }

  const byAccount = new Map<string, { accountNumber: string; accountLabel: string; sum: Money }>();
  for (const ligne of lignes) {
    const c = classifyProvisionLigne(ligne);
    if (c.categoryCode !== categoryCode || c.column !== column) continue;
    const bucket = byAccount.get(ligne.accountId) ?? {
      accountNumber: ligne.accountNumber,
      accountLabel: ligne.accountLabel,
      sum: Money.zero(),
    };
    bucket.sum = bucket.sum.plus(c.contribution);
    byAccount.set(ligne.accountId, bucket);
  }

  const accounts: Tableau2056AccountTrace[] = [...byAccount.entries()].map(([accountId, b]) => ({
    accountId,
    accountNumber: b.accountNumber,
    accountLabel: b.accountLabel,
    contribution: b.sum.toApiString(),
  }));

  // Independent second derivation, same discipline as the other two Tier-2 trace modules.
  const forward = computeTableau2056(lignes);
  const ligne = forward.lignes.find((l) => l.code === categoryCode);
  if (!ligne) {
    throw new BadRequestException(`La ligne 2056 "${categoryCode}" n'est pas traçable.`);
  }
  const officialValue = Money.fromString(
    column === 'debut'
      ? ligne.montantDebut
      : column === 'dotations'
        ? ligne.dotations
        : ligne.reprises,
  );
  const summed = accounts.reduce(
    (sum, a) => sum.plus(Money.fromString(a.contribution)),
    Money.zero(),
  );
  if (!summed.equals(officialValue)) {
    throw new ConflictException(
      `Traçabilité rompue pour 2056 ${categoryCode}/${column} : détail = ${summed.toApiString()}, ` +
        `ligne officielle = ${officialValue.toApiString()}.`,
    );
  }

  return {
    categoryCode,
    categoryLabel: category.label,
    column,
    columnValue: officialValue.toApiString(),
    fiscalYearId,
    accounts,
  };
}
