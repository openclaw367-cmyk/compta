/**
 * Money is a string everywhere in this app — API boundary, component
 * props, form state — never a JS number. Formatting for display and
 * normalizing user keystrokes are both pure string operations below;
 * neither ever calls Number()/parseFloat() on a monetary value. See
 * CLAUDE.md "Money handling".
 */

const ZERO = '0.00';

/** True for a well-formed API money string ("1234.56", "0.00", "-12.30"). */
export function isMoneyString(value: string): boolean {
  return /^-?\d+\.\d{2}$/.test(value);
}

/**
 * Formats an API money string ("1234.56") as French currency
 * ("1 234,56 €"): non-breaking space thousands separator, comma decimal,
 * € suffix, a true minus sign for negatives. Pure string manipulation —
 * no Number()/parseFloat(), so there is no float-precision path to audit.
 */
export function formatMoneyFr(value: string): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [integerPart = '0', fractionPart = '00'] = unsigned.split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const cents = fractionPart.padEnd(2, '0').slice(0, 2);
  const sign = negative && grouped !== '0' ? '−' : '';
  return `${sign}${grouped},${cents} €`;
}

/**
 * Normalizes a user keystroke buffer (e.g. "1 200,5" or "1200.5") toward
 * the API's canonical "1234.56" shape, without ever going through a
 * number.
 */
export function normalizeMoneyInput(raw: string): string {
  return raw.trim().replace(/\s/g, '').replace(',', '.');
}

/**
 * Filters a grid cell's keystroke buffer down to what an amount can
 * contain — digits, a single leading minus, a single decimal separator
 * (dot or comma, kept as comma for display) — so the buffer can never
 * become something toCents() would choke on, and so paste of e.g.
 * "1 234,56 €" degrades gracefully instead of being rejected outright.
 */
export function sanitizeAmountBuffer(raw: string): string {
  let result = '';
  let seenSeparator = false;
  for (const ch of raw) {
    if (ch === '-' && result === '') {
      result += ch;
    } else if (/\d/.test(ch)) {
      result += ch;
    } else if ((ch === ',' || ch === '.') && !seenSeparator) {
      result += ',';
      seenSeparator = true;
    }
  }
  return result;
}

/** Adds two API money strings without ever touching a JS number. */
export function addMoneyStrings(a: string, b: string): string {
  const [aInt, aFrac] = toCents(a);
  const [bInt, bFrac] = toCents(b);
  const totalCents = aInt * 100n + aFrac + bInt * 100n + bFrac;
  return centsToApiString(totalCents);
}

export function subtractMoneyStrings(a: string, b: string): string {
  const [aInt, aFrac] = toCents(a);
  const [bInt, bFrac] = toCents(b);
  const totalCents = aInt * 100n + aFrac - (bInt * 100n + bFrac);
  return centsToApiString(totalCents);
}

export function isZeroMoney(value: string): boolean {
  return normalizeMoneyInput(value) === '' || centsOf(value) === 0n;
}

export function isNegativeMoney(value: string): boolean {
  return value.trim().startsWith('-') && !isZeroMoney(value);
}

/**
 * Percentage strings from the backend are plain decimals ("40.00" =
 * 40.00%), NOT money (see financial-analysis.ts's own `percentOrNull` —
 * a ratio "genuinely isn't money") — comma-localized here for display,
 * never re-computed. `null` is a real "n/a" (a zero-denominator guard),
 * not a loading/error state.
 */
export function formatPercent(value: string | null): string {
  if (value === null) return 'n/a';
  const negative = value.startsWith('-');
  return `${negative ? '−' : ''}${value.replace('-', '').replace('.', ',')} %`;
}

/** Dimensionless ratio (e.g. liquidité générale) — same comma-localization, no % suffix. */
export function formatRatio(value: string | null): string {
  if (value === null) return 'n/a';
  const negative = value.startsWith('-');
  return `${negative ? '−' : ''}${value.replace('-', '').replace('.', ',')}`;
}

/** BigInt-safe ordering for sorting/max-finding — negative/zero/positive, never a Number(). */
export function compareMoneyStrings(a: string, b: string): number {
  const diff = centsOf(a) - centsOf(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

/**
 * value/max as a plain JS number in [0, 1] — for chart bar-height/width
 * scaling ONLY. This is the one deliberate place in this file that
 * produces a `number`: it's a dimensionless UI ratio, never a monetary
 * value in its own right (nothing here is ever formatted as an amount
 * or fed back into money arithmetic). The division itself stays
 * BigInt-exact (scaled to basis points) all the way through; only the
 * already-safe small ratio crosses into a JS number, at the boundary
 * where it stops being money and starts being layout. A non-positive
 * max or value clamps to 0 rather than dividing by zero or going
 * negative-height.
 */
export function moneyRatio(value: string, max: string): number {
  const maxCents = centsOf(max);
  const valueCents = centsOf(value);
  if (maxCents <= 0n || valueCents <= 0n) {
    return 0;
  }
  const basisPoints = (valueCents * 10000n) / maxCents;
  const clamped = basisPoints > 10000n ? 10000n : basisPoints;
  return Number(clamped) / 10000;
}

function centsOf(value: string): bigint {
  const [whole, frac] = toCents(value);
  return whole * 100n + frac;
}

/**
 * Splits a money string into (whole, cents) as BigInts. BigInt, not
 * Number, is what keeps this exact for the sums this app cares about
 * (line/entry totals) while still never touching Decimal-only backend
 * arithmetic — that stays server-side; this is purely for instant UI
 * feedback (the live balance indicator) ahead of the server's own check.
 */
function toCents(value: string): [bigint, bigint] {
  const normalized = normalizeMoneyInput(value || ZERO);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholeRaw = '0', fracRaw = '0'] = unsigned.split('.');
  const whole = BigInt(wholeRaw || '0') * (negative ? -1n : 1n);
  const frac = BigInt(fracRaw.padEnd(2, '0').slice(0, 2)) * (negative ? -1n : 1n);
  return [whole, frac];
}

function centsToApiString(totalCents: bigint): string {
  const negative = totalCents < 0n;
  const abs = negative ? -totalCents : totalCents;
  const whole = abs / 100n;
  const cents = abs % 100n;
  return `${negative ? '-' : ''}${whole.toString()}.${cents.toString().padStart(2, '0')}`;
}
