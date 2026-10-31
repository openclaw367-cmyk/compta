import { BadRequestException, Injectable } from '@nestjs/common';
import { Money } from '../../common/decimal/money';
import { ParsedStatement, ParsedStatementLine } from './camt053-parser.service';

interface QifRawTransaction {
  date: string | null;
  amount: string | null;
  payee: string | null;
  memo: string | null;
  reference: string | null;
}

/**
 * QIF (Quicken Interchange Format) statement import — the fourth
 * supported bank-statement format alongside CAMT.053/CSV/OFX (see
 * CLAUDE.md "Bank reconciliation — OFX/QIF statement import"). A much
 * simpler, line-based, field-code format: a `!Type:` header, then one
 * block per transaction terminated by a line containing only `^`, with
 * field-code lines (`D`=date, `T`/`U`=amount, `P`=payee, `M`=memo,
 * `N`=check/reference number). Unrecognized field codes (`L`=category,
 * `C`=cleared status, `A`=address, ...) are silently ignored — out of
 * scope for a bank-statement import, same "thin dispatch, not a general
 * Quicken importer" scoping as every other parser in this module.
 *
 * Deliberately produces NO opening/closing balance (always `null`) —
 * QIF carries no balance information of any kind, unlike CAMT.053's own
 * `OPBD`/`CLBD` or OFX's own `LEDGERBAL`, the same documented "no
 * balance oracle exists for this format" choice already made for the
 * CSV importer (see `CsvStatementParserService`) — not an oversight.
 * `iban` is always `null` too — QIF has no account-identity field at
 * all beyond the file-level `!Type:` header.
 *
 * Amounts (`T`/`U`) are signed with a decimal POINT always (per the QIF
 * convention, confirmed from the format's own documented grammar — the
 * same "decimal point always" convention OFX uses) and MAY carry a
 * comma thousands separator (the classic US-locale Quicken export);
 * commas are stripped before parsing, never treated as a decimal
 * separator — unlike the CSV importer, which lets the caller choose.
 * Dates (`D`) vary across real-world exports more than any other field
 * in this module — this parser handles `MM/DD/YYYY`, `MM/DD/YY`, and
 * the classic Quicken `MM/DD'YY` (apostrophe-year) convention, and
 * throws a clear, named error for anything else rather than guessing.
 *
 * Built and tested against a hand-crafted sample
 * (`__fixtures__/sample-statement.qif`) — NOT checked against a real
 * bank or Quicken export, same honestly-flagged pre-ship caveat already
 * recorded for the CAMT.053 fixture (see CLAUDE.md).
 */
@Injectable()
export class QifStatementParserService {
  parse(qif: string): ParsedStatement {
    if (!/^!Type:/im.test(qif)) {
      throw new BadRequestException('Fichier QIF invalide — en-tête "!Type:" introuvable.');
    }

    const rawLines = qif.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const transactions: QifRawTransaction[] = [];
    let current: QifRawTransaction = this.emptyTransaction();
    let hasAnyField = false;

    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('!')) continue;
      if (line === '^') {
        if (hasAnyField) transactions.push(current);
        current = this.emptyTransaction();
        hasAnyField = false;
        continue;
      }
      const code = line[0];
      const value = line.slice(1).trim();
      switch (code) {
        case 'D':
          current.date = value;
          hasAnyField = true;
          break;
        case 'T':
        case 'U':
          current.amount = value;
          hasAnyField = true;
          break;
        case 'P':
          current.payee = value;
          hasAnyField = true;
          break;
        case 'M':
          current.memo = value;
          hasAnyField = true;
          break;
        case 'N':
          current.reference = value;
          hasAnyField = true;
          break;
        default:
          // Other field codes (L=categorie, C=cleared, A=address, ...)
          // are out of scope for a bank-statement import — ignored, not
          // guessed at.
          break;
      }
    }
    // A file whose last transaction block is missing its closing `^`
    // terminator is still honored (flushed here) rather than silently
    // dropped — "never silently drop real data" outweighs strict
    // terminator conformance for a hand-built/possibly-truncated export.
    if (hasAnyField) transactions.push(current);

    if (transactions.length === 0) {
      throw new BadRequestException('Aucune transaction trouvée dans le fichier QIF.');
    }

    const lines = transactions.map((t, index) => this.toStatementLine(t, index));
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

  private toStatementLine(t: QifRawTransaction, index: number): ParsedStatementLine {
    const context = `transaction ${index + 1}`;
    if (!t.date) {
      throw new BadRequestException(`Date manquante (D) pour la ${context} du fichier QIF.`);
    }
    if (!t.amount) {
      throw new BadRequestException(`Montant manquant (T/U) pour la ${context} du fichier QIF.`);
    }

    const amount = this.parseAmount(t.amount, context);
    const label = this.firstNonEmpty(t.payee, t.memo) ?? '(sans libellé)';

    return {
      bookingDate: this.parseDate(t.date, context),
      valueDate: null,
      amount: amount.toApiString(),
      label,
      bankReference: t.reference,
    };
  }

  private parseAmount(raw: string, context: string): Money {
    const normalized = raw.trim().replace(/,/g, '');
    try {
      return Money.fromString(normalized);
    } catch {
      throw new BadRequestException(
        `Montant invalide ("${raw}") pour la ${context} du fichier QIF.`,
      );
    }
  }

  /** Handles MM/DD/YYYY, MM/DD/YY, and the classic Quicken MM/DD'YY convention. */
  private parseDate(raw: string, context: string): string {
    const trimmed = raw.trim();

    let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (match) {
      const [, month, day, year] = match;
      return this.toIso(year, month, day, context, trimmed);
    }

    match = /^(\d{1,2})\/(\d{1,2})'(\d{2})$/.exec(trimmed);
    if (match) {
      const [, month, day, shortYear] = match;
      return this.toIso(this.expandYear(shortYear), month, day, context, trimmed);
    }

    match = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(trimmed);
    if (match) {
      const [, month, day, shortYear] = match;
      return this.toIso(this.expandYear(shortYear), month, day, context, trimmed);
    }

    throw new BadRequestException(
      `Format de date non reconnu ("${raw}") pour la ${context} du fichier QIF — formats ` +
        "supportés : MM/DD/YYYY, MM/DD/YY, MM/DD'YY.",
    );
  }

  private expandYear(shortYear: string): string {
    return (Number(shortYear) > 50 ? '19' : '20') + shortYear;
  }

  private toIso(year: string, month: string, day: string, context: string, raw: string): string {
    const iso = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    if (Number.isNaN(new Date(iso).getTime())) {
      throw new BadRequestException(`Date invalide ("${raw}") pour la ${context} du fichier QIF.`);
    }
    return iso;
  }

  private firstNonEmpty(...values: (string | null)[]): string | null {
    for (const value of values) {
      if (value !== null && value.trim() !== '') return value.trim();
    }
    return null;
  }

  private emptyTransaction(): QifRawTransaction {
    return { date: null, amount: null, payee: null, memo: null, reference: null };
  }
}
