import type { Worksheet } from 'exceljs';

/**
 * Shared, small helpers for writing an .xlsx report — see CLAUDE.md
 * "Reporting/export flexibility". `exceljs` (already installed, used
 * today only for READING an uploaded Excel import) is generic enough
 * on its own that no bigger abstraction is warranted; these two
 * helpers are the only genuinely-reused pieces across all 6 reports'
 * Excel exports.
 */

/** Excel/OOXML has no decimal cell type — every numeric cell is an
 *  IEEE754 double. This is the ONE sanctioned place a money string
 *  crosses into a JS `number` in this app: at the terminal boundary of
 *  writing a spreadsheet cell, never before it, and the result is never
 *  read back into money arithmetic (mirrors `Money.fromNumber()`'s own
 *  "edge conversion only" discipline in `common/decimal/money.ts`).
 *  Safe because every monetary value here is bounded NUMERIC(15,2) —
 *  well within a double's exact-integer range once expressed in cents. */
export function moneyToExcelNumber(value: string): number {
  return Number(value);
}

/** Same boundary-crossing exception as `moneyToExcelNumber()`, generalized to any other
 *  Decimal-sourced numeric string that isn't money (a percentage, a ratio, a day count) — still
 *  bounded, still terminal, still never read back into arithmetic. `null` (a real "n/a" from a
 *  zero-denominator guard, not a loading/error state) writes the literal text "n/a" instead of a number. */
export function numericStringOrNullToExcelValue(value: string | null): number | string {
  return value === null ? 'n/a' : Number(value);
}

/** Two-decimal, thousands-grouped number format for a money column. */
export const MONEY_NUMBER_FORMAT = '#,##0.00';

/** Bold, light-grey-filled header row — applied consistently across every report's sheet(s). */
export function styleHeaderRow(worksheet: Worksheet, rowNumber: number): void {
  const row = worksheet.getRow(rowNumber);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
  });
}
