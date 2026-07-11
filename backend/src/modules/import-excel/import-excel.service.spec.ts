import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
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
        { id: 'acc-607', number: '607000' },
        { id: 'acc-401', number: '401000' },
      ]),
    },
    importBatch: {
      create: jest.fn((args: { data: unknown }) => ({ id: 'batch-1', ...(args.data as object) })),
    },
  };
}

describe('ImportExcelService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: ImportExcelService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new ImportExcelService(prisma as unknown as PrismaService);
  });

  it('imports a balanced two-line écriture as a draft', async () => {
    const buffer = await buildWorkbookBuffer([
      ['1', 'AC', '2026-01-15', '607000', 'Achat fournitures', 100, 0],
      ['1', 'AC', '2026-01-15', '401000', 'Achat fournitures', 0, 100],
    ]);

    await service.importJournal(company, 'fy-1', { originalname: 'journal.xlsx', buffer });

    expect(prisma.importBatch.create).toHaveBeenCalledTimes(1);
    const call = prisma.importBatch.create.mock.calls[0][0] as {
      data: { ecritures: { create: { lignes: { create: unknown[] } }[] } };
    };
    expect(call.data.ecritures.create).toHaveLength(1);
    expect(call.data.ecritures.create[0].lignes.create).toHaveLength(2);
  });

  it('rejects an import where a group does not balance', async () => {
    const buffer = await buildWorkbookBuffer([
      ['1', 'AC', '2026-01-15', '607000', 'Achat fournitures', 100, 0],
      ['1', 'AC', '2026-01-15', '401000', 'Achat fournitures', 0, 99],
    ]);

    await expect(
      service.importJournal(company, 'fy-1', { originalname: 'journal.xlsx', buffer }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.importBatch.create).not.toHaveBeenCalled();
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

  it('rejects a workbook missing a required column', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Journal');
    sheet.addRow(['EcritureRef', 'JournalCode']); // missing most required columns
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    await expect(
      service.importJournal(company, 'fy-1', { originalname: 'journal.xlsx', buffer }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an import against a closed fiscal year', async () => {
    prisma.fiscalYear.findFirst.mockResolvedValueOnce({
      id: 'fy-1',
      label: '2026',
      closedAt: new Date(),
    });
    const buffer = await buildWorkbookBuffer([
      ['1', 'AC', '2026-01-15', '607000', 'Achat fournitures', 100, 0],
      ['1', 'AC', '2026-01-15', '401000', 'Achat fournitures', 0, 100],
    ]);

    await expect(
      service.importJournal(company, 'fy-1', { originalname: 'journal.xlsx', buffer }),
    ).rejects.toThrow(BadRequestException);
  });
});
