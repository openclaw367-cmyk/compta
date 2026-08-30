import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { roundToNearestEuro } from './vat-rounding';
import {
  Ca3Ligne,
  Ca3VatRate,
  COLLECTEE_PREFIX,
  IMPLEMENTED_RATES,
  REVENUE_PCG_CLASS,
  computeCa3Declaration,
  findImplementedRate,
} from './ca3-declaration';

/**
 * Traceability drill-down, Tier 3 — CA3 lignes 08/09/9B/T6 (collectée
 * by rate). See CLAUDE.md "Traceability drill-down" and
 * `ca3-declaration.ts`'s own doc comment. Genuinely different shape
 * from every prior tier: a rate is tagged PER-LIGNE via
 * `EcritureLigne.vatRateId`, not pinned to one account — the same
 * account can carry lines at different rates, so the reverse mapping
 * is a fresh per-ligne classification, not a reuse of any per-account
 * classifier. `findImplementedRate()` is still the SAME forward
 * primitive (now exported), reused here unchanged — no separately-
 * written rate resolution.
 *
 * **No "→ écritures" hop this pass, deliberately, same "stop at the
 * honest bottom" discipline as 2054's own "début" column.**
 * `AccountLedgerDrilldown` is scoped by `fiscalYearId` (with an
 * optional Du/Au sub-range), but a VAT declaration period doesn't
 * necessarily align with one fiscal year at all — resolving "which
 * fiscal year(s) cover this period" would need either a new date-range
 * lookup (a real, not-yet-decided prerequisite, parallel to
 * `DepreciationService.findFiscalYearContaining()` but for an
 * arbitrary period rather than a single date, including the
 * period-spans-two-fiscal-years edge case) or a genuinely new
 * period-scoped écriture-list endpoint — out of this pass's stated
 * "new but small" scope. The account-level détail below (which DOES
 * tie to the line via the oracle) is the honest bottom of this chain.
 */

export type Ca3TraceColumn = 'baseHT' | 'taxe';

export interface Ca3LigneWithAccount extends Ca3Ligne {
  accountId: string;
  accountLabel: string;
}

export interface Ca3AccountTrace {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  contribution: string;
}

export interface Ca3LineTraceResult {
  ligne: string;
  label: string;
  column: Ca3TraceColumn;
  columnValue: string;
  accounts: Ca3AccountTrace[];
}

export function traceCa3RateColumn(
  lignes: Ca3LigneWithAccount[],
  vatRates: Ca3VatRate[],
  periodStart: string,
  periodEnd: string,
  ligneCode: string,
  column: Ca3TraceColumn,
): Ca3LineTraceResult {
  const rate = IMPLEMENTED_RATES.find((r) => r.ligne === ligneCode);
  if (!rate) {
    throw new BadRequestException(`La ligne CA3 "${ligneCode}" n'est pas traçable.`);
  }
  const ratesById = new Map(vatRates.map((r) => [r.id, Money.fromDecimal(r.ratePercent)]));

  const byAccount = new Map<string, { accountNumber: string; accountLabel: string; sum: Money }>();
  for (const ligne of lignes) {
    if (!ligne.vatRateId) continue;
    const ratePercent = ratesById.get(ligne.vatRateId);
    if (!ratePercent) continue;
    let implemented;
    try {
      implemented = findImplementedRate(ratePercent);
    } catch {
      continue;
    }
    if (implemented.ligne !== ligneCode) continue;

    const debit = Money.fromDecimal(ligne.debit);
    const credit = Money.fromDecimal(ligne.credit);
    const isCollectee = ligne.compteNumber.startsWith(COLLECTEE_PREFIX);
    const isRevenue = ligne.pcgClass === REVENUE_PCG_CLASS;
    if (column === 'taxe' && !isCollectee) continue;
    if (column === 'baseHT' && !isRevenue) continue;

    // Same "credit − debit" formula the forward computation uses for BOTH bucket.taxe and
    // bucket.baseHT — the column filter above (isCollectee vs isRevenue) already decided which
    // lines qualify, so once qualified there's only one formula to apply.
    const contribution = credit.minus(debit);
    const bucket = byAccount.get(ligne.accountId) ?? {
      accountNumber: ligne.compteNumber,
      accountLabel: ligne.accountLabel,
      sum: Money.zero(),
    };
    bucket.sum = bucket.sum.plus(contribution);
    byAccount.set(ligne.accountId, bucket);
  }

  const accounts: Ca3AccountTrace[] = [...byAccount.entries()].map(([accountId, b]) => ({
    accountId,
    accountNumber: b.accountNumber,
    accountLabel: b.accountLabel,
    contribution: b.sum.toApiString(),
  }));

  // Independent second derivation, same discipline as every other trace tier — re-run the FULL
  // forward declaration and read its own (already-rounded) figure for this exact (ligne, column).
  const forward = computeCa3Declaration(lignes, vatRates, periodStart, periodEnd);
  const forwardLigne = forward.collecteeByRate.find((l) => l.ligne === ligneCode);
  if (!forwardLigne) {
    throw new BadRequestException(`La ligne CA3 "${ligneCode}" n'est pas traçable.`);
  }
  const officialValue = Money.fromString(
    column === 'taxe' ? forwardLigne.taxe : forwardLigne.baseHT,
  );
  // Rounded at the same declaration-line boundary as the forward computation — never applied to the
  // raw per-account contributions themselves, only to their sum, exactly like roundToNearestEuro's
  // own doc comment requires.
  const summed = roundToNearestEuro(
    accounts.reduce((sum, a) => sum.plus(Money.fromString(a.contribution)), Money.zero()),
  );
  if (!summed.equals(officialValue)) {
    throw new ConflictException(
      `Traçabilité rompue pour CA3 ${ligneCode}/${column} : détail = ${summed.toApiString()}, ` +
        `ligne officielle = ${officialValue.toApiString()}.`,
    );
  }

  return {
    ligne: ligneCode,
    label: rate.label,
    column,
    columnValue: officialValue.toApiString(),
    accounts,
  };
}
