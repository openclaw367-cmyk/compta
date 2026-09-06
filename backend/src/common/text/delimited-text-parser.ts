/**
 * Minimal RFC4180-ish delimited-text parser: a configurable single-char
 * delimiter, quoted fields (a quoted field may itself contain the
 * delimiter, a literal newline, or an escaped `""` for a literal quote
 * character), and both CRLF/LF line endings. Deliberately hand-rolled
 * rather than a new npm dependency — this project already reuses
 * `exceljs` for spreadsheet parsing (see import-excel.service.ts), but
 * that library's own CSV reader is stream-oriented and awkward for an
 * in-memory string; this ~60-line parser is small enough to own outright
 * and is shared by both new delimited-text importers that needed one in
 * the same pass — the CSV bank-statement importer (comma/semicolon/tab,
 * caller-chosen) and the FEC file importer (pipe-delimited `.txt` per
 * Article A47 A-1 du LPF, or a `.csv` variant) — see CLAUDE.md. Returns
 * one `string[]` per row; a wholly blank trailing row (the file ending
 * on a newline) is dropped, since that's a file-formatting artifact, not
 * a data row.
 */
export function parseDelimitedText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const len = normalized.length;

  let i = 0;
  while (i < len) {
    const ch = normalized[i];

    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Flush the final field/row — the input rarely ends with a trailing
  // newline that already flushed everything above.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}
