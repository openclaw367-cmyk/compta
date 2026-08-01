import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { ImportExcelService } from './import-excel.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

const COLUMNS = [
  'EcritureRef',
  'JournalCode',
  'EcritureDate',
  'CompteNum',
  'EcritureLib',
  'Debit',
  'Credit',
];

async function buildWorkbookBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Journal');
  sheet.addRow(COLUMNS);
  for (const row of rows) sheet.addRow(row);
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

function makePrismaMock() {
  return {
    fiscalYear: {
      findFirst: jest.fn().mockResolvedValue({ id: 'fy-1', label: '2026', closedAt: null }),
    },
    journal: {
      findMany: jest.fn().mockResolvedValue([{ id: 'journal-1', code: 'AC' }]),
    },
    account: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'acc-607', number: '607000', label: 'Achats de marchandises' },
        { id: 'acc-401', number: '401000', label: 'Fournisseurs' },
      ]),
    },
    ecriture: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    importBatch: {
      create: jest.fn((args: { data: unknown }) => ({ id: 'batch-1', ...(args.data as object) })),
    },
  };
}

const BALANCED_ROWS: (string | number)[][] = [
  ['1', 'AC', '2026-01-15', '607000', 'Achat fournitures', 100, 0],
  ['1', 'AC', '2026-01-15', '401000', 'Achat fournitures', 0, 100],
];

describe('ImportExcelService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: ImportExcelService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new ImportExcelService(prisma as unknown as PrismaService);
  });

  describe('importJournal', () => {
    it('imports a balanced two-line écriture as a draft', async () => {
      const buffer = await buildWorkbookBuffer(BALANCED_ROWS);

      await service.importJournal(company, 'fy-1', { originalname: 'journal.xlsx', buffer });

      expect(prisma.importBatch.create).toHaveBeenCalledTimes(1);
      const call = prisma.importBatch.create.mock.calls[0][0] as {
        data: { status: string; ecritures: { create: { lignes: { create: unknown[] } }[] } };
      };
      expect(call.data.status).toBe('COMMITTED');
      expect(call.data.ecritures.create).toHaveLength(1);
      expect(call.data.ecritures.create[0].lignes.create).toHaveLength(2);
    });

    it('rejects an import where a group does not balance, persisting a FAILED batch', async () => {
      const buffer = await buildWorkbookBuffer([
        ['1', 'AC', '2026-01-15', '607000', 'Achat fournitures', 100, 0],
        ['1', 'AC', '2026-01-15', '401000', 'Achat fournitures', 0, 99],
      ]);

      await expect(
        service.importJournal(company, 'fy-1', { originalname: 'journal.xlsx', buffer }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.importBatch.create).toHaveBeenCalledTimes(1);
      const call = prisma.importBatch.create.mock.calls[0][0] as {
        data: { status: string; errors: string[]; ecritures?: unknown };
      };
      expect(call.data.status).toBe('FAILED');
      expect(call.data.errors[0]).toMatch(/does not balance/);
      expect(call.data.ecritures).toBeUndefined();
    });

    it('rejects an import referencing an unknown account number', async () => {
      const buffer = await buildWorkbookBuffer([
        ['1', 'AC', '2026-01-15', '999999', 'Achat fournitures', 100, 0],
        ['1', 'AC', '2026-01-15', '401000', 'Achat fournitures', 0, 100],
      ]);

      await expect(
        service.importJournal(company, 'fy-1', { originalname: 'journal.xlsx', buffer }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a workbook missing a required column, persisting a FAILED batch', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Journal');
      sheet.addRow(['EcritureRef', 'JournalCode']); // missing most required columns
      const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

      await expect(
        service.importJournal(company, 'fy-1', { originalname: 'journal.xlsx', buffer }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.importBatch.create).toHaveBeenCalledTimes(1);
      const call = prisma.importBatch.create.mock.calls[0][0] as { data: { status: string } };
      expect(call.data.status).toBe('FAILED');
    });

    it('rejects an import against a closed fiscal year', async () => {
      prisma.fiscalYear.findFirst.mockResolvedValueOnce({
        id: 'fy-1',
        label: '2026',
        closedAt: new Date(),
      });
      const buffer = await buildWorkbookBuffer(BALANCED_ROWS);

      await expect(
        service.importJournal(company, 'fy-1', { originalname: 'journal.xlsx', buffer }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('preview', () => {
    it('is a pure read: never calls importBatch.create, even on a valid file', async () => {
      const buffer = await buildWorkbookBuffer(BALANCED_ROWS);

      const result = await service.preview(company, 'fy-1', {
        originalname: 'journal.xlsx',
        buffer,
      });

      expect(prisma.importBatch.create).not.toHaveBeenCalled();
      expect(result.fileErrors).toEqual([]);
      expect(result.rejected).toEqual([]);
      expect(result.toImport).toHaveLength(1);
      expect(result.toImport[0]).toMatchObject({
        ecritureRef: '1',
        journalCode: 'AC',
        ecritureDate: '2026-01-15',
        total: '100.00',
        isDuplicate: false,
      });
      expect(result.toImport[0].lignes).toEqual([
        {
          compteNum: '607000',
          compteLib: 'Achats de marchandises',
          debit: '100.00',
          credit: '0.00',
        },
        { compteNum: '401000', compteLib: 'Fournisseurs', debit: '0.00', credit: '100.00' },
      ]);
    });

    it('reports rejected groups with their errors, and never writes', async () => {
      const buffer = await buildWorkbookBuffer([
        ['1', 'AC', '2026-01-15', '607000', 'Achat fournitures', 100, 0],
        ['1', 'AC', '2026-01-15', '401000', 'Achat fournitures', 0, 99],
      ]);

      const result = await service.preview(company, 'fy-1', {
        originalname: 'journal.xlsx',
        buffer,
      });

      expect(prisma.importBatch.create).not.toHaveBeenCalled();
      expect(result.toImport).toEqual([]);
      expect(result.rejected).toEqual([
        { ecritureRef: '1', errors: [expect.stringContaining('does not balance')] },
      ]);
    });

    it('reports file-level errors for a missing column, and never writes', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Journal');
      sheet.addRow(['EcritureRef', 'JournalCode']);
      const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

      const result = await service.preview(company, 'fy-1', {
        originalname: 'journal.xlsx',
        buffer,
      });

      expect(prisma.importBatch.create).not.toHaveBeenCalled();
      expect(result.fileErrors[0]).toMatch(/Missing required column/);
      expect(result.toImport).toEqual([]);
      expect(result.rejected).toEqual([]);
    });

    it('flags a group matching an existing écriture as a duplicate warning, not an error', async () => {
      prisma.ecriture.findMany.mockResolvedValueOnce([
        {
          id: 'existing-1',
          ecritureNum: '4',
          ecritureDate: new Date(Date.UTC(2026, 0, 15)),
          journal: { code: 'AC' },
          lignes: [
            {
              compteId: 'acc-607',
              debit: new Prisma.Decimal('100.00'),
              credit: new Prisma.Decimal('0.00'),
            },
            {
              compteId: 'acc-401',
              debit: new Prisma.Decimal('0.00'),
              credit: new Prisma.Decimal('100.00'),
            },
          ],
        },
      ]);
      const buffer = await buildWorkbookBuffer(BALANCED_ROWS);

      const result = await service.preview(company, 'fy-1', {
        originalname: 'journal.xlsx',
        buffer,
      });

      expect(prisma.importBatch.create).not.toHaveBeenCalled();
      expect(result.toImport).toHaveLength(1);
      expect(result.toImport[0].isDuplicate).toBe(true);
      expect(result.toImport[0].duplicateOf).toBe('écriture existante n°4');
    });

    it('flags two structurally identical groups within the same file (second is the duplicate)', async () => {
      const buffer = await buildWorkbookBuffer([
        ['1', 'AC', '2026-01-15', '607000', 'Achat fournitures', 100, 0],
        ['1', 'AC', '2026-01-15', '401000', 'Achat fournitures', 0, 100],
        ['2', 'AC', '2026-01-15', '607000', 'Achat fournitures (bis)', 100, 0],
        ['2', 'AC', '2026-01-15', '401000', 'Achat fournitures (bis)', 0, 100],
      ]);

      const result = await service.preview(company, 'fy-1', {
        originalname: 'journal.xlsx',
        buffer,
      });

      expect(result.toImport).toHaveLength(2);
      const first = result.toImport.find((g) => g.ecritureRef === '1')!;
      const second = result.toImport.find((g) => g.ecritureRef === '2')!;
      expect(first.isDuplicate).toBe(false);
      expect(second.isDuplicate).toBe(true);
      expect(second.duplicateOf).toContain('EcritureRef "1"');
    });

    it('does not flag groups on a different date as duplicates', async () => {
      prisma.ecriture.findMany.mockResolvedValueOnce([
        {
          id: 'existing-1',
          ecritureNum: '4',
          ecritureDate: new Date(Date.UTC(2026, 0, 16)), // one day off
          journal: { code: 'AC' },
          lignes: [
            {
              compteId: 'acc-607',
              debit: new Prisma.Decimal('100.00'),
              credit: new Prisma.Decimal('0.00'),
            },
            {
              compteId: 'acc-401',
              debit: new Prisma.Decimal('0.00'),
              credit: new Prisma.Decimal('100.00'),
            },
          ],
        },
      ]);
      const buffer = await buildWorkbookBuffer(BALANCED_ROWS);

      const result = await service.preview(company, 'fy-1', {
        originalname: 'journal.xlsx',
        buffer,
      });

      expect(result.toImport[0].isDuplicate).toBe(false);
    });

    it('rejects a preview against a closed fiscal year', async () => {
      prisma.fiscalYear.findFirst.mockResolvedValueOnce({
        id: 'fy-1',
        label: '2026',
        closedAt: new Date(),
      });
      const buffer = await buildWorkbookBuffer(BALANCED_ROWS);

      await expect(
        service.preview(company, 'fy-1', { originalname: 'journal.xlsx', buffer }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.importBatch.create).not.toHaveBeenCalled();
    });
  });
});
