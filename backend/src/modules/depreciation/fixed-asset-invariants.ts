import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';

export interface FixedAssetSummary {
  /** Cost value — always the acquisition cost, independent of residualValue or postings. */
  valeurBrute: Money;
  /** Sum of this asset's dotations that have actually been posted (postedEcritureId set) — never the projected schedule. */
  amortissementsCumules: Money;
  /** valeurBrute - amortissementsCumules. The figure that ties to the bilan. */
  vnc: Money;
}

/**
 * VNC = valeur brute − amortissements cumulés, always — computed here so
 * every caller (list view, reports) gets the identical formula rather than
 * risking drift from an independently-derived value. amortissementsCumules
 * only counts entries actually posted to the ledger (postedEcritureId set),
 * not the full theoretical schedule, since VNC must tie to the bilan.
 */
export function computeFixedAssetSummary(
  asset: { acquisitionValue: Prisma.Decimal },
  postedDotations: { amount: Prisma.Decimal }[],
): FixedAssetSummary {
  const valeurBrute = Money.fromDecimal(asset.acquisitionValue);
  const amortissementsCumules = postedDotations.reduce(
    (sum, entry) => sum.plus(Money.fromDecimal(entry.amount)),
    Money.zero(),
  );
  return { valeurBrute, amortissementsCumules, vnc: valeurBrute.minus(amortissementsCumules) };
}

/**
 * Refuses to post a dotation that would push cumulative posted dotations
 * past the depreciable base (acquisitionValue - residualValue). Should
 * never trigger for a schedule computed by computeLinearSchedule and
 * posted period-by-period, but a schedule can be regenerated after the
 * asset's own data changes (see DepreciationService.generateSchedule), so
 * this is a real, enforced invariant rather than a documentation comment.
 */
export function assertWithinDepreciableBase(
  asset: { acquisitionValue: Prisma.Decimal; residualValue: Prisma.Decimal },
  alreadyPosted: Money,
  toPost: Money,
): void {
  const base = Money.fromDecimal(asset.acquisitionValue).minus(Money.fromDecimal(asset.residualValue));
  const prospective = alreadyPosted.plus(toPost);
  if (prospective.minus(base).isPositive()) {
    throw new ConflictException(
      `Posting ${toPost.toApiString()} would bring cumulative posted dotations to ` +
        `${prospective.toApiString()}, exceeding the depreciable base of ${base.toApiString()} ` +
        'for this asset.',
    );
  }
}

interface AccountRef {
  number: string;
  pcgClass: number;
}

/**
 * The account triplet is what makes a dotation post correctly: get any of
 * these wrong and the écriture is technically balanced but semantically
 * nonsense (e.g. crediting an asset account instead of its amortissements
 * contra-account). Validated against the PCG numbering convention, not
 * just "is a class-2/6 account" — 280-289 and 20-27 are both class 2 but
 * mean opposite things.
 */
export function assertValidAccountTriplet(triplet: {
  asset: AccountRef;
  depreciation: AccountRef;
  expense: AccountRef;
}): void {
  const { asset, depreciation, expense } = triplet;
  if (asset.pcgClass !== 2 || /^2[89]/.test(asset.number)) {
    throw new BadRequestException(
      `Account "${asset.number}" is not a valid immobilisation account (expected PCG class 2, ` +
        'excluding 28x amortissements / 29x dépréciations).',
    );
  }
  if (!depreciation.number.startsWith('28')) {
    throw new BadRequestException(
      `Account "${depreciation.number}" is not a valid amortissements account (expected to start with "28").`,
    );
  }
  if (!expense.number.startsWith('681')) {
    throw new BadRequestException(
      `Account "${expense.number}" is not a valid dotations aux amortissements expense account ` +
        '(expected to start with "681").',
    );
  }
}
