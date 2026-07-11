import { Prisma } from '@prisma/client';

/**
 * The only type allowed to represent a monetary value anywhere in the
 * domain layer, DTOs, or API responses. See CLAUDE.md "Money handling".
 *
 * Deliberately has no implicit conversion from `number`: constructing a
 * Money from a float must be a conscious, explicit act (`Money.fromNumber`,
 * used only at the edge when reading legacy/external data), never something
 * that happens by accident via `new Money(someFloat)`.
 */
export class Money {
  private readonly value: Prisma.Decimal;

  private constructor(value: Prisma.Decimal) {
    this.value = value;
  }

  /** Parse a monetary value from a string (API boundary, DB row, CSV/Excel cell). */
  static fromString(value: string): Money {
    if (typeof value !== 'string') {
      throw new TypeError('Money.fromString requires a string; got ' + typeof value);
    }
    return new Money(new Prisma.Decimal(value));
  }

  /** Wrap a Prisma.Decimal as read from the database. */
  static fromDecimal(value: Prisma.Decimal): Money {
    if (!Prisma.Decimal.isDecimal(value)) {
      throw new TypeError('Money.fromDecimal requires a Prisma.Decimal instance');
    }
    return new Money(value);
  }

  /**
   * Explicit, intentionally-named escape hatch for the rare case of reading
   * a float from a source we don't control (e.g. a third-party API). Not a
   * substitute for Money.fromString — never call this on a value derived
   * from ledger arithmetic.
   */
  static fromNumber(value: number): Money {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('Money.fromNumber requires a finite number');
    }
    return new Money(new Prisma.Decimal(value));
  }

  static zero(): Money {
    return new Money(new Prisma.Decimal(0));
  }

  plus(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  minus(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  times(multiplier: number | string): Money {
    return new Money(this.value.times(multiplier));
  }

  /** Divides by a plain count (e.g. a number of years), not another Money. */
  dividedBy(divisor: number): Money {
    return new Money(this.value.dividedBy(divisor));
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  equals(other: Money): boolean {
    return this.value.equals(other.value);
  }

  /** For persisting via Prisma (`data: { debit: money.toDecimal() }`). */
  toDecimal(): Prisma.Decimal {
    return this.value;
  }

  /** Canonical 2-decimal string with a decimal point, for the JSON API boundary. */
  toApiString(): string {
    return this.value.toFixed(2);
  }

  /**
   * 2-decimal string with a decimal COMMA, per Article A47 A-1 du LPF §XII
   * (codage des informations) — the FEC file uses French numeric notation,
   * not the point used at the JSON API boundary. Used nowhere except FEC
   * export; do not use this for anything else.
   */
  toFecString(): string {
    return this.value.toFixed(2).replace('.', ',');
  }

  toJSON(): string {
    return this.toApiString();
  }
}
