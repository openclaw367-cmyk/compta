import { BadRequestException } from '@nestjs/common';
import { CsvStatementParserService } from './csv-statement-parser.service';

describe('CsvStatementParserService', () => {
  const service = new CsvStatementParserService();

  describe('detectColumns', () => {
    it('sniffs the delimiter and returns the header + sample rows', () => {
      const csv =
        'Date;Libelle;Montant\n01/03/2026;Virement;100,00\n02/03/2026;Prelevement;-50,00\n';
      const result = service.detectColumns(csv);
      expect(result.delimiter).toBe(';');
      expect(result.headers).toEqual(['Date', 'Libelle', 'Montant']);
      expect(result.sampleRows).toEqual([
        ['01/03/2026', 'Virement', '100,00'],
        ['02/03/2026', 'Prelevement', '-50,00'],
      ]);
    });

    it('throws on an empty file', () => {
      expect(() => service.detectColumns('')).toThrow(BadRequestException);
    });
  });

  describe('parse — single signed-amount column', () => {
    const csv =
      'Date;Libelle;Montant;Reference\n' +
      '01/03/2026;Virement recu;100,00;REF1\n' +
      '02/03/2026;Prelevement EDF;-50,00;REF2\n';

    it('parses a semicolon-delimited file with a French decimal comma', () => {
      const result = service.parse(csv, {
        dateColumn: 'Date',
        labelColumn: 'Libelle',
        amountColumn: 'Montant',
        referenceColumn: 'Reference',
        dateFormat: 'DMY',
        decimalSeparator: ',',
      });
      expect(result.openingBalance).toBeNull();
      expect(result.closingBalance).toBeNull();
      expect(result.lines).toEqual([
        {
          bookingDate: '2026-03-01',
          valueDate: null,
          amount: '100.00',
          label: 'Virement recu',
          bankReference: 'REF1',
        },
        {
          bookingDate: '2026-03-02',
          valueDate: null,
          amount: '-50.00',
          label: 'Prelevement EDF',
          bankReference: 'REF2',
        },
      ]);
      expect(result.periodStart).toBe('2026-03-01');
      expect(result.periodEnd).toBe('2026-03-02');
    });

    it('inverts the sign when invertSign is set', () => {
      const result = service.parse(csv, {
        dateColumn: 'Date',
        labelColumn: 'Libelle',
        amountColumn: 'Montant',
        dateFormat: 'DMY',
        decimalSeparator: ',',
        invertSign: true,
      });
      expect(result.lines[0].amount).toBe('-100.00');
      expect(result.lines[1].amount).toBe('50.00');
    });
  });

  describe('parse — separate debit/credit columns', () => {
    const csv =
      'Date,Description,Debit,Credit\n' +
      '15/06/2026,Salaire,,2000.00\n' +
      '16/06/2026,Loyer,750.00,\n';

    it('derives a signed amount (credit - debit)', () => {
      const result = service.parse(csv, {
        dateColumn: 'Date',
        labelColumn: 'Description',
        debitColumn: 'Debit',
        creditColumn: 'Credit',
        dateFormat: 'DMY',
        decimalSeparator: '.',
      });
      expect(result.lines).toEqual([
        {
          bookingDate: '2026-06-15',
          valueDate: null,
          amount: '2000.00',
          label: 'Salaire',
          bankReference: null,
        },
        {
          bookingDate: '2026-06-16',
          valueDate: null,
          amount: '-750.00',
          label: 'Loyer',
          bankReference: null,
        },
      ]);
    });
  });

  it('throws when neither amountColumn nor a debit/credit pair is given', () => {
    expect(() =>
      service.parse('Date,Libelle\n01/01/2026,x\n', {
        dateColumn: 'Date',
        labelColumn: 'Libelle',
        dateFormat: 'DMY',
        decimalSeparator: '.',
      }),
    ).toThrow(BadRequestException);
  });

  it('throws naming the missing column when the mapping references a header that does not exist', () => {
    expect(() =>
      service.parse('Date,Libelle,Montant\n01/01/2026,x,10\n', {
        dateColumn: 'DateInexistante',
        labelColumn: 'Libelle',
        amountColumn: 'Montant',
        dateFormat: 'DMY',
        decimalSeparator: '.',
      }),
    ).toThrow(BadRequestException);
  });

  it('throws on an unparseable date', () => {
    expect(() =>
      service.parse('Date,Libelle,Montant\npas-une-date,x,10\n', {
        dateColumn: 'Date',
        labelColumn: 'Libelle',
        amountColumn: 'Montant',
        dateFormat: 'DMY',
        decimalSeparator: '.',
      }),
    ).toThrow(BadRequestException);
  });

  it('skips a wholly blank row', () => {
    const csv = 'Date,Libelle,Montant\n01/01/2026,a,10\n,,\n02/01/2026,b,20\n';
    const result = service.parse(csv, {
      dateColumn: 'Date',
      labelColumn: 'Libelle',
      amountColumn: 'Montant',
      dateFormat: 'DMY',
      decimalSeparator: '.',
    });
    expect(result.lines).toHaveLength(2);
  });

  it('defaults a blank label to the honest placeholder', () => {
    const csv = 'Date,Libelle,Montant\n01/01/2026,,10\n';
    const result = service.parse(csv, {
      dateColumn: 'Date',
      labelColumn: 'Libelle',
      amountColumn: 'Montant',
      dateFormat: 'DMY',
      decimalSeparator: '.',
    });
    expect(result.lines[0].label).toBe('(sans libellé)');
  });
});
