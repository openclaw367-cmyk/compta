import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';

/** The 18 columns required by Article A47 A-1 du LPF, in exact order. */
export const FEC_COLUMNS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
] as const;

export const FEC_DELIMITER = '|';
export const FEC_LINE_BREAK = '\r\n';

/**
 * PieceRef/PieceDate must never be blank, even when an écriture has no
 * natural supporting document (e.g. écritures d'à nouveau) — Article A47
 * A-1 du LPF §180/§190 require a company-defined conventional value in
 * that case, documented in the accompanying description (§VI-390). This
 * is the conventional value used for PieceRef; PieceDate falls back to
 * the écriture's own EcritureDate (see fec-export.service.ts).
 */
export const FEC_CONVENTIONAL_PIECE_REF = 'NA';

/** AAAAMMJJ, no separators. */
export function formatFecDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Fixed 2-decimal amount with a decimal COMMA, per Article A47 A-1 du LPF
 * §XII. Formatted from Decimal, never a float.
 */
export function formatFecAmount(value: Prisma.Decimal): string {
  return Money.fromDecimal(value).toFecString();
}

export function fecFileName(identifier: string, fiscalYearEnd: Date): string {
  return `${identifier}FEC${formatFecDate(fiscalYearEnd)}.txt`;
}
