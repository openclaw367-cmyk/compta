import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Camt053ParserService } from './camt053-parser.service';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'sample-camt053.xml');

/**
 * Verified against the hand-built, spec-compliant fixture
 * (`__fixtures__/sample-camt053.xml`) — see that file's own doc comment
 * and CLAUDE.md "Bank reconciliation" for why: no real bank CAMT.053
 * export was available when this was written. Every expected value
 * below is hand-traced against the literal fixture XML, not copied from
 * the parser's own output.
 */
describe('Camt053ParserService', () => {
  const service = new Camt053ParserService();
  const xml = readFileSync(FIXTURE_PATH, 'utf-8');

  it('parses the statement period and balances from OPBD/CLBD', () => {
    const result = service.parse(xml);
    expect(result.iban).toBe('FR7630001007941234567890185');
    expect(result.periodStart).toBe('2026-03-01');
    expect(result.periodEnd).toBe('2026-03-31');
    expect(result.openingBalance).toBe('5000.00');
    expect(result.closingBalance).toBe('7974.50');
  });

  it('parses all five entries with the correct signed amounts', () => {
    const result = service.parse(xml);
    expect(result.lines).toHaveLength(5);
    expect(result.lines.map((l) => l.amount)).toEqual([
      '1200.00',
      '-450.00',
      '-100.00',
      '2400.00',
      '-75.50',
    ]);
  });

  it('extracts booking/value dates and the bank reference for the first entry', () => {
    const result = service.parse(xml);
    expect(result.lines[0]).toMatchObject({
      bookingDate: '2026-03-05',
      valueDate: '2026-03-05',
      bankReference: 'REF001',
    });
  });

  it('extracts the label from RmtInf/Ustrd when present (the primary path)', () => {
    const result = service.parse(xml);
    expect(result.lines[0].label).toBe('VIR CLIENT LEROY FACTURE SAMPLE-VE-0001');
    expect(result.lines[1].label).toBe('PRLV EDF FACTURE ELECTRICITE');
  });

  it('falls back to AddtlTxInf when RmtInf/Ustrd is absent (the second path)', () => {
    const result = service.parse(xml);
    expect(result.lines[2].label).toBe('FRAIS DE TENUE DE COMPTE');
  });

  it("falls back to the entry's own AddtlNtryInf when neither TxDtls path exists (the third path)", () => {
    const result = service.parse(xml);
    expect(result.lines[4].label).toBe('COMMISSION CARTE BANCAIRE');
  });

  it('throws BadRequestException on invalid XML', () => {
    expect(() => service.parse('<not><valid</not>')).toThrow(BadRequestException);
  });

  it('throws BadRequestException when Document > BkToCstmrStmt > Stmt is missing', () => {
    expect(() => service.parse('<Document><Other/></Document>')).toThrow(BadRequestException);
  });

  it('throws BadRequestException when OPBD/CLBD balances are missing', () => {
    const xmlNoBalances = `<Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>FR1</IBAN></Id></Acct></Stmt></BkToCstmrStmt></Document>`;
    expect(() => service.parse(xmlNoBalances)).toThrow(BadRequestException);
  });

  it('throws ConflictException when opening + entries does not sum to closing (the oracle)', () => {
    const brokenXml = xml.replace('<Amt Ccy="EUR">7974.50</Amt>', '<Amt Ccy="EUR">9999.99</Amt>');
    expect(() => service.parse(brokenXml)).toThrow(ConflictException);
  });

  it('never lets an amount reach the caller as a JS number, even internally', () => {
    // parseTagValue:false is what prevents fast-xml-parser's default
    // numeric auto-coercion — this test would fail loudly (a Money
    // construction TypeError) if that option were ever removed, since
    // Money.fromString() rejects a non-string input.
    const result = service.parse(xml);
    for (const line of result.lines) {
      expect(typeof line.amount).toBe('string');
    }
    expect(typeof result.openingBalance).toBe('string');
  });
});
