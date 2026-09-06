import ExcelJS from 'exceljs';
import { cellValueToString } from '../import-excel/import-excel.service';
import { parseDelimitedText } from '../../common/text/delimited-text-parser';
import { FEC_COLUMNS } from '../fec/fec-format';

/** Pipe first — Article A47 A-1 du LPF's own compliant delimiter (see fec-format.ts). */
const CANDIDATE_DELIMITERS = ['|', ';', '\t', ','] as const;

/** Columns without which an écriture can't be meaningfully built at all. */
const REQUIRED_HEADERS: readonly string[] = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'EcritureLib',
  'Debit',
  'Credit',
];

/** One raw FEC row, field values still as-read (untyped/unparsed) — see FEC_COLUMNS. */
export interface RawFecRecord {
  rowNumber: number;
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  ecritureDateRaw: string;
  compteNum: string;
  compteLib: string;
  compAuxNum: string;
  compAuxLib: string;
  pieceRef: string;
  pieceDateRaw: string;
  ecritureLib: string;
  debitRaw: string;
  creditRaw: string;
  ecritureLet: string;
  dateLetRaw: string;
  validDateRaw: string;
  montantDeviseRaw: string;
  idDevise: string;
}

export interface ImportedFecFile {
  originalname: string;
  buffer: Buffer;
}

/**
 * Format detection + raw-row extraction for a FEC (Fichier des Écritures
 * Comptables) file — Article A47 A-1 du LPF's own compliant export is a
 * pipe-delimited `.txt`, but real-world FEC files (and re-exports from
 * other accounting software) commonly arrive as `.csv` or `.xlsx` too —
 * hence supporting all three, per the build instruction. A `.xlsx` is
 * parsed with `exceljs` (already a dependency, see import-excel.service.ts);
 * `.txt`/`.csv` (and anything else) go through the shared
 * `parseDelimitedText()` primitive with the delimiter auto-detected by
 * trying each candidate and keeping whichever header-row split matches
 * the most real FEC column names — more robust than counting raw
 * delimiter occurrences, since a label column can itself contain a comma
 * or semicolon. Header names are matched case-insensitively against
 * `FEC_COLUMNS` (the same canonical list `fec-export.service.ts` writes),
 * so a column ORDER differing from the export's own canonical order is
 * fine — a real-world import doesn't require the exact export layout,
 * only the right column NAMES.
 *
 * Every field is returned as a raw, untyped string (or '' if the column
 * was missing/blank) — parsing amounts/dates into Money/Date happens one
 * layer up, in FecImportService, the same "raw parse, then a separate
 * validation pass" split import-excel.service.ts already uses.
 */
export async function parseFecFile(
  file: ImportedFecFile,
): Promise<{ records: RawFecRecord[] } | { fileErrors: string[] }> {
  if (/\.xlsx$/i.test(file.originalname)) {
    return parseFecWorkbook(file.buffer);
  }
  return parseFecDelimitedText(file.buffer.toString('utf-8'));
}

function buildHeaderIndex(headers: string[]): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((raw, i) => {
    const trimmed = raw.trim();
    const canonical = FEC_COLUMNS.find((c) => c.toLowerCase() === trimmed.toLowerCase());
    if (canonical && !index.has(canonical)) {
      index.set(canonical, i);
    }
  });
  return index;
}

function missingRequiredColumns(index: Map<string, number>): string[] {
  return REQUIRED_HEADERS.filter((name) => !index.has(name));
}

function detectDelimiter(headerLine: string): string {
  let best = { delimiter: CANDIDATE_DELIMITERS[0] as string, matchCount: -1 };
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const headers = headerLine.split(delimiter).map((h) => h.trim());
    const matchCount = buildHeaderIndex(headers).size;
    if (matchCount > best.matchCount) {
      best = { delimiter, matchCount };
    }
  }
  return best.delimiter;
}

function parseFecDelimitedText(
  text: string,
): { records: RawFecRecord[] } | { fileErrors: string[] } {
  const headerLine = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  if (headerLine.trim() === '') {
    return { fileErrors: ['Fichier vide.'] };
  }
  const delimiter = detectDelimiter(headerLine);
  const rows = parseDelimitedText(text, delimiter);
  if (rows.length === 0) {
    return { fileErrors: ['Fichier vide.'] };
  }
  const headerIndex = buildHeaderIndex(rows[0]);
  const missing = missingRequiredColumns(headerIndex);
  if (missing.length > 0) {
    return {
      fileErrors: [
        `Colonne(s) obligatoire(s) manquante(s) dans le fichier FEC : ${missing.join(', ')}.`,
      ],
    };
  }
  if (rows.length < 2) {
    return { fileErrors: ['Le fichier ne contient aucune ligne de données.'] };
  }
  const records = rows.slice(1).map((row, i) => toRawRecord(row, headerIndex, i + 2));
  return { records };
}

async function parseFecWorkbook(
  buffer: Buffer,
): Promise<{ records: RawFecRecord[] } | { fileErrors: string[] }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch (error) {
    return {
      fileErrors: [
        `Fichier .xlsx illisible (${error instanceof Error ? error.message : String(error)}).`,
      ],
    };
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { fileErrors: ['Le classeur ne contient aucune feuille.'] };
  }

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellValueToString(cell.value).trim();
  });
  const headerIndex = buildHeaderIndex(headers);
  const missing = missingRequiredColumns(headerIndex);
  if (missing.length > 0) {
    return {
      fileErrors: [
        `Colonne(s) obligatoire(s) manquante(s) dans le fichier FEC : ${missing.join(', ')}.`,
      ],
    };
  }

  const records: RawFecRecord[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (row.cellCount === 0) return;
    const cells: string[] = [];
    for (let i = 1; i <= headers.length; i++) {
      cells[i - 1] = cellValueToString(row.getCell(i).value);
    }
    if (cells.every((c) => c.trim() === '')) return;
    records.push(toRawRecord(cells, headerIndex, rowNumber));
  });
  if (records.length === 0) {
    return { fileErrors: ['La feuille ne contient aucune ligne de données.'] };
  }
  return { records };
}

function field(row: string[], index: Map<string, number>, name: string): string {
  const i = index.get(name);
  return i === undefined ? '' : (row[i] ?? '').trim();
}

function toRawRecord(row: string[], index: Map<string, number>, rowNumber: number): RawFecRecord {
  return {
    rowNumber,
    journalCode: field(row, index, 'JournalCode'),
    journalLib: field(row, index, 'JournalLib'),
    ecritureNum: field(row, index, 'EcritureNum'),
    ecritureDateRaw: field(row, index, 'EcritureDate'),
    compteNum: field(row, index, 'CompteNum'),
    compteLib: field(row, index, 'CompteLib'),
    compAuxNum: field(row, index, 'CompAuxNum'),
    compAuxLib: field(row, index, 'CompAuxLib'),
    pieceRef: field(row, index, 'PieceRef'),
    pieceDateRaw: field(row, index, 'PieceDate'),
    ecritureLib: field(row, index, 'EcritureLib'),
    debitRaw: field(row, index, 'Debit'),
    creditRaw: field(row, index, 'Credit'),
    ecritureLet: field(row, index, 'EcritureLet'),
    dateLetRaw: field(row, index, 'DateLet'),
    validDateRaw: field(row, index, 'ValidDate'),
    montantDeviseRaw: field(row, index, 'Montantdevise'),
    idDevise: field(row, index, 'Idevise'),
  };
}
