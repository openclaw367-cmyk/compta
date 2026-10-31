import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { OfxStatementParserService } from './ofx-statement-parser.service';

const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'sample-statement.ofx');

describe('OfxStatementParserService', () => {
  const service = new OfxStatementParserService();

  describe('parse — hand-built fixture', () => {
    const ofx = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    const result = service.parse(ofx);

    it('derives the period from DTSTART/DTEND inside BANKTRANLIST', () => {
      expect(result.periodStart).toBe('2026-03-01');
      expect(result.periodEnd).toBe('2026-03-31');
    });

    it('has no opening balance — OFX has no reliable opening-balance tag at all', () => {
      expect(result.openingBalance).toBeNull();
    });

    it('reads the closing balance off LEDGERBAL/BALAMT', () => {
      expect(result.closingBalance).toBe('3050.00');
    });

    it('has no IBAN — OFX has no dedicated IBAN tag', () => {
      expect(result.iban).toBeNull();
    });

    it('parses every transaction exactly, hand-traced against the fixture', () => {
      expect(result.lines).toEqual([
        {
          bookingDate: '2026-03-05',
          valueDate: null,
          amount: '1200.00',
          label: 'VIR CLIENT LEROY', // NAME present — wins over MEMO
          bankReference: 'OFX-REF001',
        },
        {
          bookingDate: '2026-03-08',
          valueDate: null,
          amount: '-450.00',
          label: 'PRLV EDF',
          bankReference: 'OFX-REF002',
        },
        {
          bookingDate: '2026-03-12', // sliced from a 14-digit DTPOSTED (date+time)
          valueDate: null,
          amount: '-100.00',
          label: 'FRAIS DE TENUE DE COMPTE', // no NAME — falls back to MEMO
          bankReference: 'OFX-REF003',
        },
        {
          bookingDate: '2026-03-15',
          valueDate: null,
          amount: '2400.00',
          label: 'VIR CLIENT LEROY REGLEMENT',
          bankReference: null, // no FITID on this transaction — honestly absent, not guessed
        },
      ]);
    });
  });

  describe('malformed input — fails loud, names the gap', () => {
    it('throws when the <OFX> root tag is missing entirely', () => {
      expect(() => service.parse('this is not an OFX file at all')).toThrow(BadRequestException);
    });

    it('throws when no STMTTRN block is found', () => {
      expect(() => service.parse('<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>')).toThrow(
        BadRequestException,
      );
    });

    it('throws when a transaction is missing DTPOSTED', () => {
      const ofx = '<OFX><STMTTRN><TRNAMT>100.00<FITID>R1</STMTTRN></OFX>';
      expect(() => service.parse(ofx)).toThrow(BadRequestException);
    });

    it('throws when a transaction is missing TRNAMT', () => {
      const ofx = '<OFX><STMTTRN><DTPOSTED>20260301<FITID>R1</STMTTRN></OFX>';
      expect(() => service.parse(ofx)).toThrow(BadRequestException);
    });

    it('throws on an unparseable amount', () => {
      const ofx = '<OFX><STMTTRN><DTPOSTED>20260301<TRNAMT>not-a-number</STMTTRN></OFX>';
      expect(() => service.parse(ofx)).toThrow(BadRequestException);
    });

    it('throws on an unparseable date', () => {
      const ofx = '<OFX><STMTTRN><DTPOSTED>notadate<TRNAMT>100.00</STMTTRN></OFX>';
      expect(() => service.parse(ofx)).toThrow(BadRequestException);
    });
  });

  describe('edge cases', () => {
    it('falls back to a derived period (min/max of transaction dates) when BANKTRANLIST has no DTSTART/DTEND', () => {
      const ofx =
        '<OFX><STMTTRN><DTPOSTED>20260110<TRNAMT>10.00</STMTTRN>' +
        '<STMTTRN><DTPOSTED>20260220<TRNAMT>20.00</STMTTRN></OFX>';
      const result = service.parse(ofx);
      expect(result.periodStart).toBe('2026-01-10');
      expect(result.periodEnd).toBe('2026-02-20');
      expect(result.closingBalance).toBeNull();
    });

    it('defaults the label to the honest placeholder when neither NAME nor MEMO is present', () => {
      const ofx = '<OFX><STMTTRN><DTPOSTED>20260110<TRNAMT>10.00</STMTTRN></OFX>';
      const result = service.parse(ofx);
      expect(result.lines[0].label).toBe('(sans libellé)');
    });
  });
});
