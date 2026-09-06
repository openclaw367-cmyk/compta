import { BadRequestException, Injectable } from '@nestjs/common';
import { Money } from '../../common/decimal/money';
import { parseDelimitedText } from '../../common/text/delimited-text-parser';
import { ParsedStatement, ParsedStatementLine } from './camt053-parser.service';
import { CsvColumnsPreviewDto } from './dto/csv-columns-preview.dto';

const CANDIDATE_DELIMITERS = [';', ',', '\t', '|'];

export interface CsvColumnMapping {
  dateColumn: string;
  labelColumn: string;
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  referenceColumn?: string;
  dateFormat: 'DMY' | 'MDY' | 'YMD';
  decimalSeparator: ',' | '.';
  delimiter?: string;
  invertSign?: boolean;
}

/**
 * CSV bank-statement import — the second supported format alongside
 * CAMT.053 (see CLAUDE.md "Bank reconciliation"). Unlike CAMT.053,
 * there is no standardized column layout for a bank's own CSV export —
 * every bank (and every bookkeeping tool re-exporting one) names and
 * orders its columns differently, some split debit/credit into two
 * columns, some use a single signed amount, date formats vary. Rather
 * than guess, `detectColumns()` sniffs the delimiter and header row so
 * a human can pick the mapping once in the UI, and `parse()` only ever
 * parses against a caller-supplied, explicit mapping — the "flexible
 * column mapping" design confirmed via AskUserQuestion before this was
 * built.
 *
 * Deliberately produces NO opening/closing balance — a bank CSV export
 * commonly carries no such fields at all, unlike CAMT.053's own
 * OPBD/CLBD, so `assertBalancesReconcile()`-style oracle simply has
 * nothing honest to check against here (also an explicit, confirmed
 * decision, not an oversight — see CLAUDE.md).
 */
@Injectable()
export class CsvStatementParserService {
  detectColumns(csv: string): CsvColumnsPreviewDto {
    const delimiter = this.detectDelimiter(csv);
    const rows = parseDelimitedText(csv, delimiter);
    if (rows.length === 0) {
      throw new BadRequestException('Fichier CSV vide.');
    }
    return {
      delimiter,
      headers: rows[0].map((h) => h.trim()),
      sampleRows: rows.slice(1, 6),
    };
  }

  parse(csv: string, mapping: CsvColumnMapping): ParsedStatement {
    if (!mapping.amountColumn && !(mapping.debitColumn && mapping.creditColumn)) {
      throw new BadRequestException(
        'Le mapping doit indiquer soit une colonne de montant signé, soit une paire de colonnes débit/crédit.',
      );
    }

    const delimiter = mapping.delimiter ?? this.detectDelimiter(csv);
    const rows = parseDelimitedText(csv, delimiter);
    if (rows.length < 2) {
      throw new BadRequestException('Fichier CSV vide ou sans ligne de mouvement.');
    }

    const headers = rows[0].map((h) => h.trim());
    const columnIndex = (name: string): number => {
      const index = headers.indexOf(name);
      if (index === -1) {
        throw new BadRequestException(
          `Colonne "${name}" introuvable dans l'en-tête du fichier (colonnes trouvées : ${headers.join(', ')}).`,
        );
      }
      return index;
    };

    const dateIdx = columnIndex(mapping.dateColumn);
    const labelIdx = columnIndex(mapping.labelColumn);
    const amountIdx = mapping.amountColumn ? columnIndex(mapping.amountColumn) : null;
    const debitIdx = mapping.debitColumn ? columnIndex(mapping.debitColumn) : null;
    const creditIdx = mapping.creditColumn ? columnIndex(mapping.creditColumn) : null;
    const refIdx = mapping.referenceColumn ? columnIndex(mapping.referenceColumn) : null;

    const lines: ParsedStatementLine[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every((cell) => cell.trim() === '')) continue;
      const rowNumber = i + 1;

      const bookingDate = this.parseDate(row[dateIdx] ?? '', mapping.dateFormat, rowNumber);
      const label = (row[labelIdx] ?? '').trim() || '(sans libellé)';
      const amount = this.resolveAmount(
        row,
        { amountIdx, debitIdx, creditIdx },
        mapping,
        rowNumber,
      );
      const bankReference = refIdx !== null ? (row[refIdx] ?? '').trim() || null : null;

      lines.push({
        bookingDate,
        valueDate: null,
        amount: amount.toApiString(),
        label,
        bankReference,
      });
    }

    if (lines.length === 0) {
      throw new BadRequestException('Aucune ligne de mouvement trouvée dans le fichier.');
    }

    const sortedDates = [...lines.map((l) => l.bookingDate)].sort();
    return {
      iban: null,
      periodStart: sortedDates[0],
      periodEnd: sortedDates[sortedDates.length - 1],
      openingBalance: null,
      closingBalance: null,
      lines,
    };
  }

  private resolveAmount(
    row: string[],
    idx: { amountIdx: number | null; debitIdx: number | null; creditIdx: number | null },
    mapping: CsvColumnMapping,
    rowNumber: number,
  ): Money {
    if (idx.amountIdx !== null) {
      const value = this.parseAmount(row[idx.amountIdx] ?? '', mapping.decimalSeparator, rowNumber);
      return mapping.invertSign ? Money.zero().minus(value) : value;
    }
    const debitRaw = (row[idx.debitIdx!] ?? '').trim();
    const creditRaw = (row[idx.creditIdx!] ?? '').trim();
    const debit = debitRaw
      ? this.parseAmount(debitRaw, mapping.decimalSeparator, rowNumber)
      : Money.zero();
    const credit = creditRaw
      ? this.parseAmount(creditRaw, mapping.decimalSeparator, rowNumber)
      : Money.zero();
    return credit.minus(debit);
  }

  private parseAmount(raw: string, decimalSeparator: ',' | '.', rowNumber: number): Money {
    let normalized = raw.trim().replace(/\s/g, '').replace(/[€$]/g, '');
    if (normalized === '') return Money.zero();
    normalized =
      decimalSeparator === ','
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(/,/g, '');
    try {
      return Money.fromString(normalized);
    } catch {
      throw new BadRequestException(`Ligne ${rowNumber} : montant invalide ("${raw}").`);
    }
  }

  /** Returns an ISO (YYYY-MM-DD) date string, matching ParsedStatementLine's own shape. */
  private parseDate(raw: string, format: 'DMY' | 'MDY' | 'YMD', rowNumber: number): string {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
    const match = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/.exec(trimmed);
    if (!match) {
      throw new BadRequestException(`Ligne ${rowNumber} : date invalide ("${raw}").`);
    }
    const [, p1, p2, p3] = match;
    let year: string;
    let month: string;
    let day: string;
    if (format === 'YMD') {
      [year, month, day] = [p1, p2, p3];
    } else if (format === 'MDY') {
      [month, day, year] = [p1, p2, p3];
    } else {
      [day, month, year] = [p1, p2, p3];
    }
    if (year.length === 2) {
      year = (Number(year) > 50 ? '19' : '20') + year;
    }
    const iso = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    if (Number.isNaN(new Date(iso).getTime())) {
      throw new BadRequestException(`Ligne ${rowNumber} : date invalide ("${raw}").`);
    }
    return iso;
  }

  private detectDelimiter(csv: string): string {
    const firstLine = csv.split(/\r\n|\r|\n/, 1)[0] ?? '';
    let best = CANDIDATE_DELIMITERS[0];
    let bestCount = -1;
    for (const delimiter of CANDIDATE_DELIMITERS) {
      const count = firstLine.split(delimiter).length - 1;
      if (count > bestCount) {
        bestCount = count;
        best = delimiter;
      }
    }
    return best;
  }
}
