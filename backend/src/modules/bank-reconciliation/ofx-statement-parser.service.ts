import { BadRequestException, Injectable } from '@nestjs/common';
import { Money } from '../../common/decimal/money';
import { ParsedStatement, ParsedStatementLine } from './camt053-parser.service';

function extractTag(source: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(source);
  if (!match) return null;
  const value = match[1].trim();
  return value === '' ? null : value;
}

function firstNonEmpty(...values: (string | null)[]): string | null {
  for (const value of values) {
    if (value !== null && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * OFX (Open Financial Exchange) 1.x statement import — the third
 * supported bank-statement format alongside CAMT.053/CSV (see CLAUDE.md
 * "Bank reconciliation — OFX/QIF statement import"). OFX 1.x is
 * SGML-like, not XML — leaf elements commonly have no closing tag at all
 * (e.g. `<TRNAMT>123.45` followed directly by the next tag on the next
 * line), so a real XML parser doesn't apply here; this is a
 * straightforward tag-value regex extraction instead, matching this
 * codebase's own "don't add a dependency for something ~60 lines can
 * do" precedent already established for `parseDelimitedText()`. OFX 2.x
 * (proper XML) is deliberately NOT supported — most real-world bank
 * exports still use the 1.x SGML style, and this is flagged honestly as
 * a stated scope boundary, not silently assumed to be covered too.
 *
 * `<TRNAMT>` is signed per the OFX spec itself (negative = money leaving
 * the account) — the EXACT SAME convention `ParsedStatementLine.amount`
 * already uses, so, unlike CAMT.053's own `CdtDbtInd`, no sign flip is
 * needed here. The OFX spec also mandates a decimal POINT for amounts
 * regardless of locale (never a comma) — confirmed from the OFX 1.x
 * specification itself, not assumed; `Money.fromString()` is used
 * directly with no normalization.
 *
 * Deliberately produces a NULL `openingBalance`, the same documented
 * choice already made for the CSV importer (see
 * `CsvStatementParserService`) — OFX has no standardized "opening
 * balance" tag the way CAMT.053 has `OPBD`. The closing balance
 * (`<LEDGERBAL><BALAMT>`) IS commonly present and is surfaced when
 * found, but with no honest opening counterpart there is nothing for an
 * `assertBalancesReconcile()`-style internal-consistency check to
 * compare against — not attempted here, by design, not an oversight.
 * `iban` is always `null` too — OFX has no dedicated IBAN tag (only
 * `BANKID`/`ACCTID`, which may or may not hold something IBAN-shaped
 * depending on the exporting bank); treated as honestly absent rather
 * than guessed.
 *
 * Built and tested against a hand-crafted sample
 * (`__fixtures__/sample-statement.ofx`) — NOT checked against a real
 * bank export, same honestly-flagged pre-ship caveat already recorded
 * for the CAMT.053 fixture (see CLAUDE.md).
 */
@Injectable()
export class OfxStatementParserService {
  parse(ofx: string): ParsedStatement {
    if (!/<OFX>/i.test(ofx)) {
      throw new BadRequestException('Fichier OFX invalide — balise <OFX> introuvable.');
    }

    const transactionBlocks = this.extractBlocks(ofx, 'STMTTRN');
    if (transactionBlocks.length === 0) {
      throw new BadRequestException('Aucune transaction (STMTTRN) trouvée dans le fichier OFX.');
    }

    const lines = transactionBlocks.map((block, index) => this.parseTransaction(block, index));

    const tranListBlock = this.extractBlocks(ofx, 'BANKTRANLIST')[0] ?? null;
    const dtStart = tranListBlock ? extractTag(tranListBlock, 'DTSTART') : null;
    const dtEnd = tranListBlock ? extractTag(tranListBlock, 'DTEND') : null;

    const sortedDates = [...lines.map((l) => l.bookingDate)].sort();
    const periodStart = dtStart ? this.toIsoDate(dtStart, 'DTSTART') : sortedDates[0];
    const periodEnd = dtEnd ? this.toIsoDate(dtEnd, 'DTEND') : sortedDates[sortedDates.length - 1];

    const ledgerBalBlock = this.extractBlocks(ofx, 'LEDGERBAL')[0] ?? null;
    const closingBalanceRaw = ledgerBalBlock ? extractTag(ledgerBalBlock, 'BALAMT') : null;
    const closingBalance = closingBalanceRaw
      ? Money.fromString(closingBalanceRaw).toApiString()
      : null;

    return {
      iban: null, // OFX has no dedicated IBAN tag — see doc comment above.
      periodStart,
      periodEnd,
      openingBalance: null, // see doc comment above — no reliable opening-balance tag in OFX.
      closingBalance,
      lines,
    };
  }

  private parseTransaction(block: string, index: number): ParsedStatementLine {
    const context = `transaction ${index + 1}`;
    const dtPosted = extractTag(block, 'DTPOSTED');
    if (!dtPosted) {
      throw new BadRequestException(`Date manquante (DTPOSTED) pour la ${context} du fichier OFX.`);
    }
    const trnAmt = extractTag(block, 'TRNAMT');
    if (!trnAmt) {
      throw new BadRequestException(`Montant manquant (TRNAMT) pour la ${context} du fichier OFX.`);
    }

    let amount: Money;
    try {
      amount = Money.fromString(trnAmt);
    } catch {
      throw new BadRequestException(
        `Montant invalide ("${trnAmt}") pour la ${context} du fichier OFX.`,
      );
    }

    const name = extractTag(block, 'NAME');
    const memo = extractTag(block, 'MEMO');
    const label = firstNonEmpty(name, memo) ?? '(sans libellé)';
    const fitId = extractTag(block, 'FITID');

    return {
      bookingDate: this.toIsoDate(dtPosted, 'DTPOSTED'),
      valueDate: null,
      amount: amount.toApiString(),
      label,
      bankReference: fitId,
    };
  }

  /**
   * OFX dates are `YYYYMMDD`, optionally followed by a time and/or
   * timezone suffix (`YYYYMMDDHHMMSS[.xxx][gmt offset]`) — only the
   * first 8 characters are ever meaningful here.
   */
  private toIsoDate(raw: string, context: string): string {
    const digits = raw.trim().slice(0, 8);
    if (!/^\d{8}$/.test(digits)) {
      throw new BadRequestException(
        `Date invalide ("${raw}") pour ${context} dans le fichier OFX.`,
      );
    }
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    const iso = `${year}-${month}-${day}`;
    if (Number.isNaN(new Date(iso).getTime())) {
      throw new BadRequestException(
        `Date invalide ("${raw}") pour ${context} dans le fichier OFX.`,
      );
    }
    return iso;
  }

  private extractBlocks(source: string, tag: string): string[] {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      blocks.push(match[1]);
    }
    return blocks;
  }
}
