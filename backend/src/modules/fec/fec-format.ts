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

/** AAAAMMJJ, no separators. */
export function formatFecDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/** Fixed 2-decimal amount, decimal point separator, formatted from Decimal (never a float). */
export function formatFecAmount(value: Prisma.Decimal): string {
  return Money.fromDecimal(value).toApiString();
}

export function fecFileName(identifier: string, fiscalYearEnd: Date): string {
  return `${identifier}FEC${formatFecDate(fiscalYearEnd)}.txt`;
}
