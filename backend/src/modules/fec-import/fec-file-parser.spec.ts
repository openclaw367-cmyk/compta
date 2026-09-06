import ExcelJS from 'exceljs';
import { parseFecFile } from './fec-file-parser';

const HEADER =
  'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|' +
  'PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise';

function pipeFile(
  rows: string[],
  originalname = 'export.txt',
): { originalname: string; buffer: Buffer } {
  return { originalname, buffer: Buffer.from([HEADER, ...rows].join('\r\n') + '\r\n', 'utf-8') };
}

describe('parseFecFile — pipe-delimited .txt', () => {
  it('parses a compliant pipe-delimited FEC file', async () => {
    const file = pipeFile([
      'AC|Achats|1|20260301|401000|Fournisseurs|||FA001|20260301|Achat fournitures|0,00|100,00|||||',
      'AC|Achats|1|20260301|606000|Fournitures|||FA001|20260301|Achat fournitures|100,00|0,00|||||',
    ]);
    const result = await parseFecFile(file);
    expect('records' in result).toBe(true);
    if ('records' in result) {
      expect(result.records).toHaveLength(2);
      expect(result.records[0].journalCode).toBe('AC');
      expect(result.records[0].compteNum).toBe('401000');
      expect(result.records[0].creditRaw).toBe('100,00');
      expect(result.records[0].rowNumber).toBe(2);
    }
  });

  it('reports fileErrors when a required column is missing', async () => {
    const file = {
      originalname: 'export.txt',
      buffer: Buffer.from('JournalCode|EcritureDate\r\nAC|20260301\r\n', 'utf-8'),
    };
    const result = await parseFecFile(file);
    expect('fileErrors' in result).toBe(true);
    if ('fileErrors' in result) {
      expect(result.fileErrors[0]).toMatch(/manquante/i);
    }
  });

  it('reports fileErrors on an empty file', async () => {
    const result = await parseFecFile({ originalname: 'export.txt', buffer: Buffer.from('') });
    expect('fileErrors' in result).toBe(true);
  });

  it('reports fileErrors when there are no data rows', async () => {
    const result = await parseFecFile({
      originalname: 'export.txt',
      buffer: Buffer.from(HEADER + '\r\n', 'utf-8'),
    });
    expect('fileErrors' in result).toBe(true);
  });
});

describe('parseFecFile — CSV variant (semicolon-delimited .csv)', () => {
  it('auto-detects the semicolon delimiter from the header row', async () => {
    const semicolonHeader = HEADER.replace(/\|/g, ';');
    const file = {
      originalname: 'export.csv',
      buffer: Buffer.from(
        [
          semicolonHeader,
          'VE;Ventes;1;20260315;411000;Clients;;;FV001;20260315;Vente;120,00;0,00;;;;;',
        ].join('\r\n') + '\r\n',
        'utf-8',
      ),
    };
    const result = await parseFecFile(file);
    expect('records' in result).toBe(true);
    if ('records' in result) {
      expect(result.records).toHaveLength(1);
      expect(result.records[0].journalCode).toBe('VE');
      expect(result.records[0].debitRaw).toBe('120,00');
    }
  });

  it('matches header names case-insensitively and tolerates a reordered column layout', async () => {
    const reordered = [
      'compteNum',
      'compteLib',
      'journalcode',
      'journallib',
      'ecriturenum',
      'ecrituredate',
      'ecriturelib',
      'debit',
      'credit',
    ].join(',');
    const file = {
      originalname: 'export.csv',
      buffer: Buffer.from(
        [reordered, '512000,Banque,BQ,Banque,1,20260410,Depot,50,00,0,00'].join('\r\n') + '\r\n',
        'utf-8',
      ),
    };
    const result = await parseFecFile(file);
    // Note: this fixture's own values contain commas inside what would be
    // amount fields in a real file — not a realistic amount format, only
    // exercising that header matching itself is case-insensitive and
    // order-independent.
    expect('records' in result).toBe(true);
    if ('records' in result) {
      expect(result.records[0].compteNum).toBe('512000');
      expect(result.records[0].journalCode).toBe('BQ');
    }
  });
});

describe('parseFecFile — .xlsx', () => {
  it('parses an .xlsx workbook with the same 18 FEC columns', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('FEC');
    sheet.addRow(HEADER.split('|'));
    sheet.addRow([
      'OD',
      'Opérations diverses',
      '1',
      '20260101',
      '164000',
      'Emprunt',
      '',
      '',
      '',
      '',
      'Emprunt',
      0,
      9000,
      '',
      '',
      '',
      '',
      '',
    ]);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const result = await parseFecFile({ originalname: 'export.xlsx', buffer });
    expect('records' in result).toBe(true);
    if ('records' in result) {
      expect(result.records).toHaveLength(1);
      expect(result.records[0].compteNum).toBe('164000');
      expect(result.records[0].creditRaw).toBe('9000');
    }
  });

  it('reports fileErrors when the workbook has no worksheets', async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    const result = await parseFecFile({ originalname: 'export.xlsx', buffer });
    expect('fileErrors' in result).toBe(true);
  });
});
