import { Prisma } from '@prisma/client';
import { Money } from './money';

describe('Money', () => {
  it('parses a decimal string exactly, without float rounding error', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754 float; Decimal must get this exact.
    const a = Money.fromString('0.1');
    const b = Money.fromString('0.2');
    expect(a.plus(b).toApiString()).toBe('0.30');
  });

  it('rejects a raw JS number passed where a string is expected', () => {
    expect(() => Money.fromString(1234.56 as unknown as string)).toThrow(TypeError);
  });

  it('rejects a non-finite number from fromNumber', () => {
    expect(() => Money.fromNumber(Number.NaN)).toThrow(TypeError);
    expect(() => Money.fromNumber(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('rejects a plain object masquerading as a Decimal in fromDecimal', () => {
    expect(() => Money.fromDecimal({ value: '10' } as unknown as Prisma.Decimal)).toThrow(
      TypeError,
    );
  });

  it('round-trips through Prisma.Decimal without precision loss', () => {
    const money = Money.fromString('99999999999.99');
    const decimal = money.toDecimal();
    expect(Money.fromDecimal(decimal).toApiString()).toBe('99999999999.99');
  });

  it('never exposes a JS number accessor — only Decimal-safe operations', () => {
    const money = Money.fromString('10.00');
    // Money must not have a `.valueOf()`/`.toNumber()` that lets it slip
    // into native arithmetic silently.
    expect((money as unknown as { toNumber?: unknown }).toNumber).toBeUndefined();
  });

  it('serializes as a fixed 2-decimal string at the API boundary', () => {
    expect(Money.fromString('7').toApiString()).toBe('7.00');
    expect(JSON.stringify({ amount: Money.fromString('7') })).toBe('{"amount":"7.00"}');
  });

  it('correctly balances many small decimal amounts (classic float failure case)', () => {
    let sum = Money.zero();
    for (let i = 0; i < 10; i++) {
      sum = sum.plus(Money.fromString('0.1'));
    }
    expect(sum.toApiString()).toBe('1.00');
    expect(sum.equals(Money.fromString('1.00'))).toBe(true);
  });
});
