import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { Money } from '../../common/decimal/money';

export interface ParsedStatementLine {
  bookingDate: string;
  valueDate: string | null;
  /** Signed API-string (decimal point) — positive = inflow, negative = outflow. See CLAUDE.md "Bank reconciliation". */
  amount: string;
  label: string;
  bankReference: string | null;
}

export interface ParsedStatement {
  iban: string | null;
  periodStart: string;
  periodEnd: string;
  /**
   * Null for a source format with no balance oracle at all — the CSV
   * bank-statement importer (see CsvStatementParserService), whose
   * files commonly carry no opening/closing balance columns, unlike
   * CAMT.053's own OPBD/CLBD. Always non-null for CAMT.053 or a
   * Bridge-aggregator sync, both of which DO reconcile against a real
   * balance (assertBalancesReconcile()). See CLAUDE.md "Bank
   * reconciliation".
   */
  openingBalance: string | null;
  closingBalance: string | null;
  lines: ParsedStatementLine[];
}

/**
 * The raw shape fast-xml-parser produces for a camt.053 document —
 * loosely typed (everything optional) since a real bank export's own
 * optional structure varies; this is what turns `xmlParser.parse()`'s
 * own `any` return into something every property access here is
 * actually type-checked against, rather than fighting eslint's
 * no-unsafe-* rules field by field.
 */
interface RawCamt053 {
  Document?: {
    BkToCstmrStmt?: {
      Stmt?: RawStmt;
    };
  };
}
interface RawStmt {
  Acct?: { Id?: { IBAN?: string } };
  Bal?: RawBal | RawBal[];
  Ntry?: RawEntry | RawEntry[];
}
interface RawBal {
  Tp?: { CdOrPrtry?: { Cd?: string } };
  Amt?: string;
  CdtDbtInd?: string;
  Dt?: { Dt?: string };
}
interface RawEntry {
  Amt?: string;
  CdtDbtInd?: string;
  BookgDt?: { Dt?: string };
  ValDt?: { Dt?: string };
  AcctSvcrRef?: string;
  NtryDtls?: { TxDtls?: RawTxDtls | RawTxDtls[] };
  AddtlNtryInf?: string;
}
interface RawTxDtls {
  RmtInf?: { Ustrd?: string };
  AddtlTxInf?: string;
}

/**
 * `parseTagValue: false` is load-bearing, not a default left alone —
 * fast-xml-parser's default (`true`) auto-coerces numeric-looking tag
 * text (every `Amt` value) into a JS `number`, which is exactly the
 * money-as-float violation CLAUDE.md's "Money handling" forbids. Every
 * amount stays a string here and is only ever constructed into a
 * `Money` explicitly, at the one place that needs arithmetic (the sign
 * flip for DBIT).
 */
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (tagName) => tagName === 'Ntry' || tagName === 'Bal',
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function firstNonEmpty(...values: (string | undefined | null)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * ISO 20022 camt.053.001 (Bank-to-Customer Statement) parsing — see
 * CLAUDE.md "Bank reconciliation" for why this is v1's only supported
 * format. Amount/date/credit-debit-indicator are always in a fixed,
 * reliable location and are never guessed — a missing/malformed one
 * throws. The free-text label is genuinely less structured across real
 * bank exports, so it falls back through three known paths
 * (RmtInf/Ustrd → AddtlTxInf → the entry's own AddtlNtryInf) before
 * giving up with a generic placeholder — "found and parsed, or
 * honestly absent," never invented, same discipline as
 * InvoiceExtractionService.
 *
 * Built and tested against a hand-crafted, spec-compliant sample
 * (`__fixtures__/sample-camt053.xml`) — no real bank export was
 * available when this was written. Flagged honestly, not silently: a
 * real bank's own camt.053 export may format the label path (or other
 * optional structure) differently than this fixture assumes, and this
 * parser hasn't been verified against one yet.
 */
@Injectable()
export class Camt053ParserService {
  parse(xml: string): ParsedStatement {
    let parsed: RawCamt053;
    try {
      parsed = xmlParser.parse(xml) as RawCamt053;
    } catch (err) {
      throw new BadRequestException(
        `Fichier CAMT.053 illisible (XML invalide) : ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const stmt = parsed?.Document?.BkToCstmrStmt?.Stmt;
    if (!stmt) {
      throw new BadRequestException(
        'Structure CAMT.053 inattendue — élément Document > BkToCstmrStmt > Stmt introuvable.',
      );
    }

    const iban = stmt.Acct?.Id?.IBAN ?? null;

    const balances = asArray<RawBal>(stmt.Bal);
    const opening = balances.find((b) => b?.Tp?.CdOrPrtry?.Cd === 'OPBD');
    const closing = balances.find((b) => b?.Tp?.CdOrPrtry?.Cd === 'CLBD');
    if (!opening || !closing) {
      throw new BadRequestException(
        "Relevé CAMT.053 incomplet — solde d'ouverture (OPBD) ou de clôture (CLBD) introuvable.",
      );
    }

    const lines = asArray<RawEntry>(stmt.Ntry).map((entry, index) => this.parseEntry(entry, index));

    const openingBalance = this.signedAmount(opening.Amt, opening.CdtDbtInd);
    const closingBalance = this.signedAmount(closing.Amt, closing.CdtDbtInd);
    this.assertBalancesReconcile(openingBalance, closingBalance, lines);

    return {
      iban,
      periodStart: this.requireDate(opening.Dt?.Dt, "solde d'ouverture"),
      periodEnd: this.requireDate(closing.Dt?.Dt, 'solde de clôture'),
      openingBalance: openingBalance.toApiString(),
      closingBalance: closingBalance.toApiString(),
      lines,
    };
  }

  /**
   * The oracle for this parser, same discipline as
   * assertVncTiesToLedger/assertCashFlowReconciles elsewhere in this
   * app: opening + Σ(entries) must equal closing, exactly. A real bank's
   * own CAMT.053 export is internally arithmetically consistent by
   * construction — if this doesn't hold after parsing, either an entry
   * was missed/misparsed or the file itself is corrupt/truncated, and
   * either way this must never silently continue to persisting a
   * statement whose own numbers don't add up.
   */
  private assertBalancesReconcile(
    opening: Money,
    closing: Money,
    lines: ParsedStatementLine[],
  ): void {
    const sum = lines.reduce((total, line) => total.plus(Money.fromString(line.amount)), opening);
    if (!sum.equals(closing)) {
      throw new ConflictException(
        `Le relevé CAMT.053 ne se recoupe pas : solde d'ouverture (${opening.toApiString()}) + ` +
          `mouvements (${sum.minus(opening).toApiString()}) = ${sum.toApiString()}, ` +
          `mais le solde de clôture indiqué est ${closing.toApiString()}.`,
      );
    }
  }

  private parseEntry(entry: RawEntry, index: number): ParsedStatementLine {
    const bookingDate = this.requireDate(entry.BookgDt?.Dt, `ligne ${index + 1} (BookgDt)`);
    const valueDate = entry.ValDt?.Dt ?? null;
    const amount = this.signedAmount(entry.Amt, entry.CdtDbtInd, `ligne ${index + 1}`);

    const txDtls = asArray<RawTxDtls>(entry.NtryDtls?.TxDtls)[0];
    const label =
      firstNonEmpty(txDtls?.RmtInf?.Ustrd, txDtls?.AddtlTxInf, entry.AddtlNtryInf) ??
      '(sans libellé)';

    return {
      bookingDate,
      valueDate,
      amount: amount.toApiString(),
      label,
      bankReference: entry.AcctSvcrRef ?? null,
    };
  }

  private requireDate(value: unknown, context: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(`Date manquante ou invalide dans le CAMT.053 (${context}).`);
    }
    return value;
  }

  private signedAmount(amt: unknown, cdtDbtInd: unknown, context = 'solde'): Money {
    if (typeof amt !== 'string' || amt.trim() === '') {
      throw new BadRequestException(`Montant manquant ou invalide dans le CAMT.053 (${context}).`);
    }
    if (cdtDbtInd !== 'CRDT' && cdtDbtInd !== 'DBIT') {
      throw new BadRequestException(
        `Indicateur crédit/débit manquant ou invalide dans le CAMT.053 (${context}).`,
      );
    }
    const magnitude = Money.fromString(amt);
    return cdtDbtInd === 'DBIT' ? Money.zero().minus(magnitude) : magnitude;
  }
}
