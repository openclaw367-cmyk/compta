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
