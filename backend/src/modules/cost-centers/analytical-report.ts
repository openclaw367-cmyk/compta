import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { CDR_RULES } from '../liasse/compte-resultat-2052-2053';
import { resolveLineContribution } from '../liasse/liasse-line-rules';

/**
 * Roadmap item 2b ("Comptabilité analytique") — a P&L broken out by
 * cost center/project, alongside the existing company-wide compte de
 * résultat. See CLAUDE.md "Comptabilité analytique".
 *
 * Reuses CDR_RULES/resolveLineContribution() verbatim — the EXACT same
 * per-account classification primitive the compte de résultat
 * (compte-resultat-2052-2053.ts) and the Tier-1 traceability drill-down
 * already use — rather than re-deriving a parallel classification. The
 * only new idea here is grouping by an ADDITIONAL dimension
 * (costCenterId) before classifying, not a new classification engine.
 */

export interface AnalyticalLigne {
  compteNumber: string;
  pcgClass: number;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** Null = untagged — rolled into the "Non ventilé" bucket, never dropped. */
  costCenterId: string | null;
}

export interface CostCenterReportLine {
  code: string;
  label: string;
  amount: string;
}

export interface CostCenterReportBucket {
  /** Null = the "Non ventilé" bucket (untagged lines), same convention as the Dashboard's own
   *  comptes-courants-d'associés tile — see CLAUDE.md "Dashboard". */
  costCenterId: string | null;
  costCenterLabel: string;
  lines: CostCenterReportLine[];
}

export interface AnalyticalReport {
  fiscalYearId: string;
  buckets: CostCenterReportBucket[];
  /** The company-wide total per CDR code — independently derived (see
   *  assertAnalyticalTiesToOfficialTotal below), for comparison. */
  officialTotals: CostCenterReportLine[];
}

const NON_VENTILE_LABEL = 'Non ventilé';

/**
 * Pure, no I/O. Groups lignes by (compteNumber, costCenterId), resolves
 * each group's own CDR contribution via resolveLineContribution() (the
 * SAME per-account classification compte-resultat-2052-2053.ts's own
 * classifyAccounts() uses internally), then re-groups by cost center for
 * display. CDR_RULES has no DualNatureRule family (dual-nature accounts
 * — bank overdrafts, personnel/associés — are a BILAN-only concept; no
 * class-6/7 account is ever dual-nature), so grouping by cost center
 * before resolving is safe: there's no sign-dependent routing that could
 * differ between a per-account-only aggregate and a per-(account,
 * cost-center) one.
 */
export function computeAnalyticalReport(
  fiscalYearId: string,
  lignes: AnalyticalLigne[],
  costCenters: { id: string; code: string; label: string }[],
): AnalyticalReport {
  const chargesProduits = lignes.filter((l) => l.pcgClass === 6 || l.pcgClass === 7);

  // Group by (compteNumber, costCenterId) — mirrors buildTrialBalance()'s own
  // per-account aggregation, with one extra grouping key.
  const byAccountAndCenter = new Map<
    string,
    { compteNumber: string; costCenterId: string | null; debit: Money; credit: Money }
  >();
  for (const ligne of chargesProduits) {
    const key = `${ligne.compteNumber}::${ligne.costCenterId ?? ''}`;
    const entry = byAccountAndCenter.get(key) ?? {
      compteNumber: ligne.compteNumber,
      costCenterId: ligne.costCenterId,
      debit: Money.zero(),
      credit: Money.zero(),
    };
    entry.debit = entry.debit.plus(Money.fromDecimal(ligne.debit));
    entry.credit = entry.credit.plus(Money.fromDecimal(ligne.credit));
    byAccountAndCenter.set(key, entry);
  }

  const labelByCenter = new Map(costCenters.map((cc) => [cc.id, cc.label]));
  // costCenterId -> code -> amount
  const perCenterTotals = new Map<string | null, Map<string, Money>>();

  for (const { compteNumber, costCenterId, debit, credit } of byAccountAndCenter.values()) {
    const balance = debit.minus(credit);
    if (balance.isZero()) {
      continue;
    }
    const { code, contribution } = resolveLineContribution(compteNumber, balance, CDR_RULES);
    const centerTotals = perCenterTotals.get(costCenterId) ?? new Map<string, Money>();
    centerTotals.set(code, (centerTotals.get(code) ?? Money.zero()).plus(contribution));
    perCenterTotals.set(costCenterId, centerTotals);
  }

  const buckets: CostCenterReportBucket[] = [...perCenterTotals.entries()]
    .map(([costCenterId, totals]) => ({
      costCenterId,
      costCenterLabel: costCenterId
        ? (labelByCenter.get(costCenterId) ?? costCenterId)
        : NON_VENTILE_LABEL,
      lines: [...totals.entries()]
        .map(([code, amount]) => ({
          code,
          label: CDR_RULES.find((r) => r.code === code)?.label ?? code,
          amount: amount.toApiString(),
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    }))
    // Non ventilé (null) sorts last, named cost centers sort by label.
    .sort((a, b) => {
      if (a.costCenterId === null) return 1;
      if (b.costCenterId === null) return -1;
      return a.costCenterLabel.localeCompare(b.costCenterLabel);
    });

  const officialTotals = computeOfficialTotals(chargesProduits);

  assertAnalyticalTiesToOfficialTotal(buckets, officialTotals);

  return { fiscalYearId, buckets, officialTotals };
}

/**
 * The company-wide total per CDR code, ignoring cost center entirely —
 * a SEPARATE derivation from the per-bucket split above (aggregates by
 * account only, the exact same aggregation compte-resultat-2052-2053.ts's
 * own classifyAccounts() performs), used as the oracle's independent
 * reference point.
 */
function computeOfficialTotals(chargesProduits: AnalyticalLigne[]): CostCenterReportLine[] {
  const byAccount = new Map<string, { debit: Money; credit: Money }>();
  for (const ligne of chargesProduits) {
    const entry = byAccount.get(ligne.compteNumber) ?? {
      debit: Money.zero(),
      credit: Money.zero(),
    };
    entry.debit = entry.debit.plus(Money.fromDecimal(ligne.debit));
    entry.credit = entry.credit.plus(Money.fromDecimal(ligne.credit));
    byAccount.set(ligne.compteNumber, entry);
  }

  const totals = new Map<string, Money>();
  for (const [compteNumber, { debit, credit }] of byAccount) {
    const balance = debit.minus(credit);
    if (balance.isZero()) {
      continue;
    }
    const { code, contribution } = resolveLineContribution(compteNumber, balance, CDR_RULES);
    totals.set(code, (totals.get(code) ?? Money.zero()).plus(contribution));
  }

  return [...totals.entries()]
    .map(([code, amount]) => ({
      code,
      label: CDR_RULES.find((r) => r.code === code)?.label ?? code,
      amount: amount.toApiString(),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * THE oracle, same non-negotiable discipline as every other tie-out in
 * this app (assertVncTiesToLedger, assertCashFlowReconciles, ...): for
 * every CDR code appearing in the per-cost-center split, the sum across
 * every bucket (including "Non ventilé") must equal the independently-
 * derived official total for that same code, to the centime. Throws —
 * never silently accepted — on any mismatch, naming both figures.
 */
export function assertAnalyticalTiesToOfficialTotal(
  buckets: CostCenterReportBucket[],
  officialTotals: CostCenterReportLine[],
): void {
  const summed = new Map<string, Money>();
  for (const bucket of buckets) {
    for (const line of bucket.lines) {
      summed.set(
        line.code,
        (summed.get(line.code) ?? Money.zero()).plus(Money.fromString(line.amount)),
      );
    }
  }

  for (const official of officialTotals) {
    const total = summed.get(official.code) ?? Money.zero();
    if (!total.equals(Money.fromString(official.amount))) {
      throw new ConflictException(
        `Analytical report does not tie out: the per-cost-center split for line ${official.code} ` +
          `sums to ${total.toApiString()}, but the official (unsplit) total is ${official.amount}.`,
      );
    }
  }
}
