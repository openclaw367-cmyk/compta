import { BadRequestException, ConflictException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Account } from '@prisma/client';
import { PlanComptableImportService } from './plan-comptable-import.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

const COLUMNS = [
  'CompteNum',
  'CompteLib',
  'CompteParentNum',
  'Adresse',
  'CodePostal',
  'Ville',
  'PaysISO',
  'SirenRci',
  'NumeroTva',
];

async function buildWorkbookBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Plan comptable');
  sheet.addRow(COLUMNS);
  for (const row of rows) sheet.addRow(row);
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

function account(overrides: Partial<Account>): Account {
  return {
    id: 'acc-x',
    companyId: 'company-1',
    number: '000000',
    label: 'X',
    pcgClass: 0,
    isAuxiliary: false,
    addressLine: null,
    postalCode: null,
    city: null,
    countryCode: null,
    sirenOrRci: null,
    vatNumber: null,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrismaMock() {
  const prisma = {
    account: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn((args: { create: object; update: object; where: unknown }) => ({
        id: `acc-${JSON.stringify(args.where)}`,
        pcgClass: 0,
        ...args.create,
      })),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

describe('PlanComptableImportService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: PlanComptableImportService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new PlanComptableImportService(prisma as unknown as PrismaService);
  });

  describe('preview', () => {
    it('reports a missing required column as a file error', async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet('Plan comptable').addRow(['CompteLib']).commit();
      const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('CompteNum')]));
    });

    it('plans a plain account as CREATE when it does not exist yet', async () => {
      const buffer = await buildWorkbookBuffer([['607000', 'Achats de marchandises']]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual([]);
      expect(result.rows).toEqual([
        expect.objectContaining({
          number: '607000',
          label: 'Achats de marchandises',
          pcgClass: 6,
          isAuxiliary: false,
          parentNumber: null,
          action: 'CREATE',
        }),
      ]);
      expect(result.createCount).toBe(1);
      expect(result.updateCount).toBe(0);
    });

    it('plans a plain account as UPDATE when its number already exists', async () => {
      prisma.account.findMany.mockResolvedValueOnce([
        account({ id: 'acc-607', number: '607000', label: 'Old label', pcgClass: 6 }),
      ]);
      const buffer = await buildWorkbookBuffer([['607000', 'New label']]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.rows).toEqual([expect.objectContaining({ action: 'UPDATE' })]);
      expect(result.createCount).toBe(0);
      expect(result.updateCount).toBe(1);
    });

    it('rejects an account number outside the PCG class range 1-8', async () => {
      const buffer = await buildWorkbookBuffer([['9000', 'Bogus']]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('Ligne 2')]));
      expect(result.rows).toEqual([]);
    });

    it('flags a duplicate CompteNum within the same file', async () => {
      const buffer = await buildWorkbookBuffer([
        ['607000', 'Achats A'],
        ['607000', 'Achats B'],
      ]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('apparaît déjà')]),
      );
    });

    it('resolves a tiers parent from another row in the same file', async () => {
      const buffer = await buildWorkbookBuffer([
        ['411000', 'Clients'],
        [
          '411001',
          'Client Dupont',
          '411000',
          '5 rue de la Paix',
          '75002',
          'Paris',
          'FR',
          '123456789',
          'FR12123456789',
        ],
      ]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual([]);
      expect(result.rows).toEqual([
        expect.objectContaining({ number: '411000', isAuxiliary: false, action: 'CREATE' }),
        expect.objectContaining({
          number: '411001',
          isAuxiliary: true,
          parentNumber: '411000',
          pcgClass: 4,
          action: 'CREATE',
        }),
      ]);
    });

    it('resolves a tiers parent that already exists in the DB, not in the file', async () => {
      prisma.account.findMany
        .mockResolvedValueOnce([]) // existingByNumber lookup for rows in file
        .mockResolvedValueOnce([account({ id: 'acc-411', number: '411000', pcgClass: 4 })]); // parent lookup
      const buffer = await buildWorkbookBuffer([['411001', 'Client Dupont', '411000']]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual([]);
      expect(result.rows).toEqual([
        expect.objectContaining({ number: '411001', isAuxiliary: true, parentNumber: '411000' }),
      ]);
    });

    it('refuses a tiers row whose parent cannot be resolved anywhere', async () => {
      const buffer = await buildWorkbookBuffer([['411001', 'Client Dupont', '411999']]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('introuvable')]),
      );
    });

    it('refuses a tiers row whose parent is not a 401/411/455 collectif', async () => {
      const buffer = await buildWorkbookBuffer([
        ['607000', 'Achats'],
        ['607001', 'Sous-compte', '607000'],
      ]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('collectif')]));
    });

    it("refuses nested tiers (a tiers row used as another row's parent)", async () => {
      const buffer = await buildWorkbookBuffer([
        ['411000', 'Clients'],
        ['411001', 'Client Dupont', '411000'],
        ['411002', 'Sous-tiers', '411001'],
      ]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('tiers imbriqués')]),
      );
    });

    it('refuses a row that names itself as its own parent', async () => {
      const buffer = await buildWorkbookBuffer([['411000', 'Clients', '411000']]);
      const result = await service.preview(company, { originalname: 'x.xlsx', buffer });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('propre compte parent')]),
      );
    });
  });

  describe('confirmImport', () => {
    it('throws a BadRequestException for an unreadable file', async () => {
      await expect(
        service.confirmImport(company, { originalname: 'x.xlsx', buffer: Buffer.from('nope') }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws a ConflictException naming every error when the plan is invalid, and persists nothing', async () => {
      const buffer = await buildWorkbookBuffer([['9000', 'Bogus']]);
      await expect(
        service.confirmImport(company, { originalname: 'x.xlsx', buffer }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.account.upsert).not.toHaveBeenCalled();
    });

    it('upserts plain accounts first, then tiers resolved against them, and returns counts', async () => {
      const buffer = await buildWorkbookBuffer([
        ['411000', 'Clients'],
        ['411001', 'Client Dupont', '411000'],
      ]);
      prisma.account.upsert.mockImplementation(((args: { create: { number: string } }) =>
        account({
          id: `acc-${args.create.number}`,
          number: args.create.number,
          pcgClass: 4,
        })) as never);
      prisma.account.findUniqueOrThrow.mockImplementation(((args: { where: { id: string } }) =>
        account({
          id: args.where.id,
          number: '411000',
          pcgClass: 4,
          isAuxiliary: false,
        })) as never);

      const result = await service.confirmImport(company, { originalname: 'x.xlsx', buffer });

      expect(result).toEqual({ createdCount: 2, updatedCount: 0 });
      expect(prisma.account.upsert).toHaveBeenCalledTimes(2);
      // Plain account (no parent) must be upserted before the tiers row that depends on it.
      const firstCallArgs = prisma.account.upsert.mock.calls[0][0];
      const secondCallArgs = prisma.account.upsert.mock.calls[1][0];
      expect(firstCallArgs.create).toMatchObject({ number: '411000', isAuxiliary: false });
      expect(secondCallArgs.create).toMatchObject({
        number: '411001',
        isAuxiliary: true,
        parentId: 'acc-411000',
      });
    });
  });
});
