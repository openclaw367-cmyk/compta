import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';

/**
 * Rounds to the nearest euro: fractions below 0,50 are dropped, 0,50 and
 * above round up. Confirmed identical, independently, on both sides of
 * this module: the French CA3 notice (p.1/p.6/p.9) and form, and the
 * Monaco notice (Ordonnance Souveraine n°13.844, art. 1er) and form
 * itself. Shared between ca3-declaration.ts and monaco-declaration.ts
 * rather than duplicated, since it's the same confirmed rule on both.
 *
 * Declaration-line boundary only — never applied to a ledger value, and
 * never derived from another already-rounded output figure (each figure
 * is rounded once, from its own full-precision internal sum).
 */
export function roundToNearestEuro(amount: Money): Money {
  const rounded = amount.toDecimal().toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return Money.fromString(rounded.toFixed(2));
}
