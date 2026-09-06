import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FecImportService } from './fec-import.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

const COLUMN_KEYS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const HEADER = COLUMN_KEYS.join('|');

/** Builds one pipe-delimited FEC row by column NAME — avoids hand-counting delimiters. */
function fecRow(fields: Partial<Record<ColumnKey, string>>): string {
  return COLUMN_KEYS.map((key) => fields[key] ?? '').join('|');
}

function pipeFile(rows: string[], originalname = 'export.txt') {
  return { originalname, buffer: Buffer.from([HEADER, ...rows].join('\r\n') + '\r\n', 'utf-8') };
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function makePrismaMock() {
  const prisma = {
    journal: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn((args: { data: { code: string } }) => ({
        id: `journal-${args.data.code}`,
        ...args.data,
      })),
    },
    account: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn((args: { data: { number: string } }) => ({
        id: `acc-${args.data.number}`,
        ...args.data,
      })),
    },
    fiscalYear: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn((args: { data: { label: string; startDate: Date; endDate: Date } }) => ({
        id: 'fy-new',
        ...args.data,
      })),
    },
    ecriture: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    importBatch: {
      create: jest.fn((args: { data: unknown }) => ({ id: 'batch-1', ...(args.data as object) })),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

describe('FecImportService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: FecImportService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new FecImportService(prisma as unknown as PrismaService);
  });

  describe('preview', () => {
    it('parses a balanced two-line écriture and plans the missing journal/accounts', async () => {
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '607000',
          CompteLib: 'Fournitures de bureau',
          PieceRef: 'FA001',
          PieceDate: '20260301',
          EcritureLib: 'Achat fournitures',
          Debit: '100,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '401000',
          CompteLib: 'Fournisseurs',
          PieceRef: 'FA001',
          PieceDate: '20260301',
          EcritureLib: 'Achat fournitures',
          Debit: '0,00',
          Credit: '100,00',
        }),
      ]);
      const result = await service.preview(company, file);

      expect(result.fileErrors).toEqual([]);
      expect(result.totalEcrituresCount).toBe(1);
      expect(result.toImport[0].total).toBe('100.00');
      expect(result.toImport[0].lignes).toHaveLength(2);
      expect(result.journalsToCreate).toEqual([
        { code: 'AC', label: 'Achats', inferredType: 'ACHATS', typeConfident: true },
      ]);
      const accountNumbers = result.accountsToCreate.map((a) => a.number).sort();
      expect(accountNumbers).toEqual(['401000', '607000']);
      expect(result.fiscalYearPlan).toEqual({
        action: 'CREATE_NEW',
        label: 'Import FEC 2026',
        startDate: '2026-03-01',
        endDate: '2026-03-01',
      });
    });

    it('defaults an unrecognized journal code to OPERATIONS_DIVERSES, flagged not-confident', async () => {
      const file = pipeFile([
        fecRow({
          JournalCode: 'XX',
          JournalLib: 'Journal mystere',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '10,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'XX',
          JournalLib: 'Journal mystere',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '512000',
          CompteLib: 'Banque',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '10,00',
        }),
      ]);
      const result = await service.preview(company, file);
      expect(result.journalsToCreate).toEqual([
        {
          code: 'XX',
          label: 'Journal mystere',
          inferredType: 'OPERATIONS_DIVERSES',
          typeConfident: false,
        },
      ]);
    });

    it('reuses an existing fiscal year that fully contains the file range', async () => {
      prisma.fiscalYear.findMany.mockResolvedValue([
        {
          id: 'fy-1',
          label: '2026',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        },
      ]);
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '10,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '10,00',
        }),
      ]);
      const result = await service.preview(company, file);
      expect(result.fiscalYearPlan).toEqual({
        action: 'REUSE_EXISTING',
        fiscalYearId: 'fy-1',
        label: '2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
    });

    it('refuses (fileErrors) when the file range partially overlaps an existing fiscal year', async () => {
      prisma.fiscalYear.findMany.mockResolvedValue([
        {
          id: 'fy-1',
          label: '2026 S1',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-06-30'),
        },
      ]);
      // Group 1 falls INSIDE the existing fiscal year, group 2 falls OUTSIDE it —
      // the file's own [min,max] range (June -> September) therefore intersects
      // [Jan,June] without being fully contained in it: a genuine partial overlap.
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260615',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '10,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260615',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '10,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '2',
          EcritureDate: '20260901',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '5,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '2',
          EcritureDate: '20260901',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '5,00',
        }),
      ]);
      const result = await service.preview(company, file);
      expect(result.fileErrors[0]).toMatch(/chevauche partiellement/);
      expect(result.toImport).toEqual([]);
    });

    it('rejects a group that does not balance, without blocking the rest', async () => {
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '100,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '90,00',
        }),
        fecRow({
          JournalCode: 'VE',
          JournalLib: 'Ventes',
          EcritureNum: '1',
          EcritureDate: '20260302',
          CompteNum: '411000',
          CompteLib: 'Clients',
          EcritureLib: 'Vente',
          Debit: '50,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'VE',
          JournalLib: 'Ventes',
          EcritureNum: '1',
          EcritureDate: '20260302',
          CompteNum: '707000',
          CompteLib: 'Ventes',
          EcritureLib: 'Vente',
          Debit: '0,00',
          Credit: '50,00',
        }),
      ]);
      const result = await service.preview(company, file);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].errors[0]).toMatch(/déséquilibrée/);
      expect(result.toImport).toHaveLength(1);
      expect(result.toImport[0].journalCode).toBe('VE');
    });

    it('rejects the whole file (fileErrors) when an account number has no valid PCG class', async () => {
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: 'X07000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '10,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '10,00',
        }),
      ]);
      const result = await service.preview(company, file);
      expect(result.fileErrors[0]).toMatch(/PCG class/);
      expect(result.toImport).toEqual([]);
    });

    it('plans an auxiliary account inheriting its parent collectif pcgClass', async () => {
      const file = pipeFile([
        fecRow({
          JournalCode: 'VE',
          JournalLib: 'Ventes',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '411000',
          CompteLib: 'Clients',
          CompAuxNum: 'CLI01',
          CompAuxLib: 'Client Dupont',
          EcritureLib: 'Vente',
          Debit: '100,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'VE',
          JournalLib: 'Ventes',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '707000',
          CompteLib: 'Ventes',
          EcritureLib: 'Vente',
          Debit: '0,00',
          Credit: '100,00',
        }),
      ]);
      const result = await service.preview(company, file);
      const aux = result.accountsToCreate.find((a) => a.number === 'CLI01');
      expect(aux).toEqual({
        number: 'CLI01',
        label: 'Client Dupont',
        pcgClass: 4,
        isAuxiliary: true,
        parentNumber: '411000',
      });
    });

    it('flags a duplicate against an already-existing écriture, non-blocking', async () => {
      prisma.account.findMany.mockResolvedValue([
        {
          id: 'acc-607',
          number: '607000',
          label: 'Achats',
          pcgClass: 6,
          isAuxiliary: false,
          parentId: null,
        },
        {
          id: 'acc-401',
          number: '401000',
          label: 'Frs',
          pcgClass: 4,
          isAuxiliary: false,
          parentId: null,
        },
      ]);
      prisma.journal.findMany.mockResolvedValue([{ id: 'journal-ac', code: 'AC' }]);
      prisma.ecriture.findMany.mockResolvedValue([
        {
          ecritureNum: '42',
          ecritureDate: new Date('2026-03-01'),
          journal: { code: 'AC' },
          lignes: [
            { compte: { number: '607000' }, debit: decimal('100.00'), credit: decimal('0.00') },
            { compte: { number: '401000' }, debit: decimal('0.00'), credit: decimal('100.00') },
          ],
        },
      ]);
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '100,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '100,00',
        }),
      ]);
      const result = await service.preview(company, file);
      expect(result.toImport[0].isDuplicate).toBe(true);
      expect(result.toImport[0].duplicateOf).toContain('42');
    });

    it('reports fileErrors from the underlying parser (e.g. a missing required column)', async () => {
      const file = {
        originalname: 'export.txt',
        buffer: Buffer.from('JournalCode\r\nAC\r\n', 'utf-8'),
      };
      const result = await service.preview(company, file);
      expect(result.fileErrors[0]).toMatch(/manquante/i);
    });
  });

  describe('confirmImport', () => {
    it('persists new journals, accounts, a fiscal year, and one draft écriture', async () => {
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '607000',
          CompteLib: 'Fournitures',
          PieceRef: 'FA001',
          PieceDate: '20260301',
          EcritureLib: 'Achat',
          Debit: '100,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '401000',
          CompteLib: 'Fournisseurs',
          PieceRef: 'FA001',
          PieceDate: '20260301',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '100,00',
        }),
      ]);
      await service.confirmImport(company, file);

      expect(prisma.fiscalYear.create).toHaveBeenCalledTimes(1);
      expect(prisma.journal.create).toHaveBeenCalledTimes(1);
      expect(prisma.journal.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'AC', type: 'ACHATS' }) }),
      );
      expect(prisma.account.create).toHaveBeenCalledTimes(2);
      expect(prisma.importBatch.create).toHaveBeenCalledTimes(1);
      const batchArgs = prisma.importBatch.create.mock.calls[0][0] as any;
      expect(batchArgs.data.status).toBe('COMMITTED');
      const ecritureData = batchArgs.data.ecritures.create[0];
      // Never validated, never numbered — always a draft, regardless of the source file's own ValidDate.
      expect(ecritureData.validatedAt).toBeUndefined();
      expect(ecritureData.ecritureNum).toBeUndefined();
      expect(ecritureData.lignes.create).toHaveLength(2);
    });

    it('reuses an existing account/journal instead of recreating it', async () => {
      prisma.journal.findMany.mockResolvedValue([{ id: 'journal-ac', code: 'AC' }]);
      prisma.account.findMany.mockResolvedValue([
        {
          id: 'acc-607',
          number: '607000',
          label: 'Achats',
          pcgClass: 6,
          isAuxiliary: false,
          parentId: null,
        },
        {
          id: 'acc-401',
          number: '401000',
          label: 'Frs',
          pcgClass: 4,
          isAuxiliary: false,
          parentId: null,
        },
      ]);
      prisma.fiscalYear.findMany.mockResolvedValue([
        {
          id: 'fy-1',
          label: '2026',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        },
      ]);
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '100,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '100,00',
        }),
      ]);
      await service.confirmImport(company, file);

      expect(prisma.journal.create).not.toHaveBeenCalled();
      expect(prisma.account.create).not.toHaveBeenCalled();
      expect(prisma.fiscalYear.create).not.toHaveBeenCalled();
      const ecritureData = (prisma.importBatch.create.mock.calls[0][0] as any).data.ecritures
        .create[0];
      expect(ecritureData.journal.connect.id).toBe('journal-ac');
      expect(ecritureData.fiscalYear.connect.id).toBe('fy-1');
    });

    it('refuses the whole import (all-or-nothing) when one group is unbalanced, and logs a FAILED batch', async () => {
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '100,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '90,00',
        }),
      ]);
      await expect(service.confirmImport(company, file)).rejects.toThrow(BadRequestException);
      expect(prisma.account.create).not.toHaveBeenCalled();
      expect(prisma.importBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    });

    it('refuses with ConflictException on a partial fiscal-year overlap', async () => {
      prisma.fiscalYear.findMany.mockResolvedValue([
        {
          id: 'fy-1',
          label: '2026 S1',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-06-30'),
        },
      ]);
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260615',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '10,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260615',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '10,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '2',
          EcritureDate: '20260901',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '5,00',
          Credit: '0,00',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '2',
          EcritureDate: '20260901',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '5,00',
        }),
      ]);
      await expect(service.confirmImport(company, file)).rejects.toThrow(ConflictException);
    });

    it('sets lettrage/dateLettrage from the file when present', async () => {
      const file = pipeFile([
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '607000',
          CompteLib: 'Achats',
          EcritureLib: 'Achat',
          Debit: '100,00',
          Credit: '0,00',
          EcritureLet: 'A',
          DateLet: '20260305',
        }),
        fecRow({
          JournalCode: 'AC',
          JournalLib: 'Achats',
          EcritureNum: '1',
          EcritureDate: '20260301',
          CompteNum: '401000',
          CompteLib: 'Frs',
          EcritureLib: 'Achat',
          Debit: '0,00',
          Credit: '100,00',
          EcritureLet: 'A',
          DateLet: '20260305',
        }),
      ]);
      await service.confirmImport(company, file);
      const ligne = (prisma.importBatch.create.mock.calls[0][0] as any).data.ecritures.create[0]
        .lignes.create[0];
      expect(ligne.lettrage).toBe('A');
      expect(ligne.dateLettrage).toEqual(new Date('2026-03-05'));
    });
  });
});
