import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { QifStatementParserService } from './qif-statement-parser.service';

const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'sample-statement.qif');

describe('QifStatementParserService', () => {
  const service = new QifStatementParserService();

  describe('parse — hand-built fixture', () => {
    const qif = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    const result = service.parse(qif);

    it('has no balances or IBAN — QIF carries none of this at all', () => {
      expect(result.openingBalance).toBeNull();
      expect(result.closingBalance).toBeNull();
      expect(result.iban).toBeNull();
    });

    it('derives the period from the transactions themselves (QIF has no DTSTART/DTEND)', () => {
      expect(result.periodStart).toBe('2026-03-05');
      expect(result.periodEnd).toBe('2026-03-15');
    });

    it('parses every transaction exactly, hand-traced against the fixture, across all three date conventions', () => {
      expect(result.lines).toEqual([
        {
          bookingDate: '2026-03-05', // MM/DD/YYYY
          valueDate: null,
          amount: '1200.00',
          label: 'Virement recu Client Leroy', // payee present — wins over memo
          bankReference: 'QIF-REF001',
        },
        {
          bookingDate: '2026-03-08', // MM/DD/YYYY
          valueDate: null,
          amount: '-450.00',
          label: 'Prelevement EDF',
          bankReference: null, // no N field — honestly absent, not guessed
        },
        {
          bookingDate: '2026-03-12', // MM/DD'YY (classic Quicken apostrophe-year)
          valueDate: null,
          amount: '-100.00',
          label: 'Frais de tenue de compte', // no payee — falls back to memo
          bankReference: null,
        },
        {
          bookingDate: '2026-03-15', // MM/DD/YY
          valueDate: null,
          amount: '2400.00', // "2,400.00" with a thousands-separator comma, stripped
          label: 'Virement client Leroy reglement',
          bankReference: null,
        },
      ]);
    });
  });

  describe('malformed input — fails loud, names the gap', () => {
    it('throws when the !Type: header is missing entirely', () => {
      expect(() => service.parse('D03/05/2026\nT100.00\n^\n')).toThrow(BadRequestException);
    });

    it('throws when no transaction block is found', () => {
      expect(() => service.parse('!Type:Bank\n')).toThrow(BadRequestException);
    });

    it('throws when a transaction is missing its date (D)', () => {
      expect(() => service.parse('!Type:Bank\nT100.00\n^\n')).toThrow(BadRequestException);
    });

    it('throws when a transaction is missing its amount (T/U)', () => {
      expect(() => service.parse('!Type:Bank\nD03/05/2026\n^\n')).toThrow(BadRequestException);
    });

    it('throws on an unrecognized date format rather than guessing', () => {
      expect(() => service.parse('!Type:Bank\nD2026-03-05\nT100.00\n^\n')).toThrow(
        BadRequestException,
      );
    });

    it('throws on an unparseable amount', () => {
      expect(() => service.parse('!Type:Bank\nD03/05/2026\nTnot-a-number\n^\n')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('edge cases', () => {
    it('honors a trailing transaction with no closing ^ terminator, rather than silently dropping it', () => {
      const result = service.parse('!Type:Bank\nD03/05/2026\nT100.00\nPSalaire\n');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].label).toBe('Salaire');
    });

    it('ignores unknown field codes (e.g. L=categorie) without affecting the parsed line', () => {
      const result = service.parse('!Type:Bank\nD03/05/2026\nT100.00\nPSalaire\nLRevenus\n^\n');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].label).toBe('Salaire');
    });

    it('defaults the label to the honest placeholder when neither payee nor memo is present', () => {
      const result = service.parse('!Type:Bank\nD03/05/2026\nT100.00\n^\n');
      expect(result.lines[0].label).toBe('(sans libellé)');
    });
  });
});
