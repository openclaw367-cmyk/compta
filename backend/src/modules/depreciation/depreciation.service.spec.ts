import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { DepreciationMethod, Prisma } from '@prisma/client';
import { DepreciationService } from './depreciation.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntriesService } from '../entries/entries.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';

const company: CompanyContext = { companyId: 'company-1' };

const ASSET_ACCOUNT = { id: 'acc-218300', number: '218300', pcgClass: 2 };
const DEPRECIATION_ACCOUNT = { id: 'acc-281830', number: '281830', pcgClass: 2 };
const EXPENSE_ACCOUNT = { id: 'acc-681100', number: '681100', pcgClass: 6 };

function fixedAssetDto(overrides: Partial<CreateFixedAssetDto> = {}): CreateFixedAssetDto {
  return {
    label: 'Ordinateur portable',
    accountId: ASSET_ACCOUNT.id,
    depreciationAccountId: DEPRECIATION_ACCOUNT.id,
    expenseAccountId: EXPENSE_ACCOUNT.id,
    acquisitionDate: '2026-01-15',
    serviceStartDate: '2026-01-01',
    acquisitionValue: '1000.00',
    usefulLifeYears: 3,
    method: DepreciationMethod.LINEAR,
    ...overrides,
  };
}

function fiscalYear(id: string, startYear: number) {
  return {
    id,
    label: String(startYear),
    startDate: new Date(Date.UTC(startYear, 0, 1)),
    endDate: new Date(Date.UTC(startYear, 11, 31)),
  };
}

const FISCAL_YEARS = [fiscalYear('fy-2026', 2026), fiscalYear('fy-2027', 2027), fiscalYear('fy-2028', 2028)];

const LINEAR_ASSET = {
  id: 'asset-1',
  label: 'Ordinateur portable',
  method: DepreciationMethod.LINEAR,
  acquisitionValue: new Prisma.Decimal('1000.00'),
  residualValue: new Prisma.Decimal('0.00'),
  usefulLifeYears: 3,
  acquisitionDate: new Date(Date.UTC(2026, 0, 1)),
  serviceStartDate: new Date(Date.UTC(2026, 0, 1)),
  accountId: ASSET_ACCOUNT.id,
  depreciationAccountId: DEPRECIATION_ACCOUNT.id,
  expenseAccountId: EXPENSE_ACCOUNT.id,
};

function makePrismaMock() {
  const prisma = {
    account: { findMany: jest.fn() },
    fixedAsset: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    fiscalYear: { findMany: jest.fn().mockResolvedValue(FISCAL_YEARS) },
    depreciationEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      upsert: jest.fn(
        (args: { create: Record<string, unknown> }): Promise<Record<string, unknown>> =>
          Promise.resolve({ id: 'entry-x', ...args.create }),
      ),
      update: jest.fn((args: { where: { id: string }; data: unknown }) => ({
        id: args.where.id,
        ...(args.data as object),
      })),
    },
    journal: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

function makeEntriesServiceMock() {
  return {
    create: jest.fn().mockResolvedValue({ id: 'draft-1', validatedAt: null }),
    validate: jest.fn().mockResolvedValue({ id: 'draft-1', ecritureNum: '10', validatedAt: new Date() }),
  };
}

describe('DepreciationService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let entriesService: ReturnType<typeof makeEntriesServiceMock>;
  let service: DepreciationService;

  beforeEach(() => {
    prisma = makePrismaMock();
    entriesService = makeEntriesServiceMock();
    service = new DepreciationService(
      prisma as unknown as PrismaService,
      entriesService as unknown as EntriesService,
    );
  });

  describe('create', () => {
    it('creates an asset with a well-formed account triplet', async () => {
      prisma.account.findMany.mockResolvedValue([ASSET_ACCOUNT, DEPRECIATION_ACCOUNT, EXPENSE_ACCOUNT]);
      await service.create(company, fixedAssetDto());
      expect(prisma.fixedAsset.create).toHaveBeenCalled();
    });

    it('rejects a depreciation account not prefixed 28', async () => {
      const badDepreciation = { id: 'acc-607000', number: '607000', pcgClass: 6 };
      prisma.account.findMany.mockResolvedValue([ASSET_ACCOUNT, badDepreciation, EXPENSE_ACCOUNT]);
      await expect(
        service.create(company, fixedAssetDto({ depreciationAccountId: badDepreciation.id })),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.fixedAsset.create).not.toHaveBeenCalled();
    });

    it('rejects when a referenced account does not belong to the company', async () => {
      prisma.account.findMany.mockResolvedValue([ASSET_ACCOUNT, DEPRECIATION_ACCOUNT]); // expense missing
      await expect(service.create(company, fixedAssetDto())).rejects.toThrow(BadRequestException);
      expect(prisma.fixedAsset.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('reports valeurBrute, amortissementsCumules (posted-only), and vnc per asset', async () => {
      prisma.fixedAsset.findMany.mockResolvedValue([
        {
          ...LINEAR_ASSET,
          cessionDate: null,
          cessionPrice: null,
          depreciationEntries: [{ amount: new Prisma.Decimal('333.33') }],
        },
      ]);

      const [row] = await service.findAll(company);

      expect(row.valeurBrute).toBe('1000.00');
      expect(row.amortissementsCumules).toBe('333.33');
      expect(row.vnc).toBe('666.67');
    });
  });

  describe('generateSchedule', () => {
    it('rejects DECLINING assets outright', async () => {
      prisma.fixedAsset.findFirst.mockResolvedValue({ ...LINEAR_ASSET, method: DepreciationMethod.DECLINING });
      await expect(service.generateSchedule(company, 'asset-1')).rejects.toThrow(NotImplementedException);
    });

    it('throws rather than silently change an already-posted amount', async () => {
      prisma.fixedAsset.findFirst.mockResolvedValue(LINEAR_ASSET);
      prisma.depreciationEntry.findMany.mockResolvedValue([
        { fiscalYearId: 'fy-2028', amount: new Prisma.Decimal('999.99'), postedEcritureId: 'ecriture-9' },
      ]);

      await expect(service.generateSchedule(company, 'asset-1')).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips upserting an already-posted entry whose amount is unchanged', async () => {
      prisma.fixedAsset.findFirst.mockResolvedValue(LINEAR_ASSET);
      prisma.depreciationEntry.findMany
        .mockResolvedValueOnce([
          { fiscalYearId: 'fy-2028', amount: new Prisma.Decimal('333.34'), postedEcritureId: 'ecriture-9' },
        ])
        .mockResolvedValueOnce([]); // final re-fetch for the return value

      await service.generateSchedule(company, 'asset-1');

      expect(prisma.depreciationEntry.upsert).toHaveBeenCalledTimes(2); // fy-2026 and fy-2027 only
      const upsertedYears = prisma.depreciationEntry.upsert.mock.calls.map(
        (call: unknown[]) => (call[0] as { create: { fiscalYearId: string } }).create.fiscalYearId,
      );
      expect(upsertedYears).toEqual(['fy-2026', 'fy-2027']);
    });
  });

  describe('postDotation', () => {
    function depreciationEntry(overrides: Record<string, unknown> = {}) {
      return {
        id: 'entry-1',
        companyId: company.companyId,
        fixedAssetId: 'asset-1',
        fiscalYearId: 'fy-2026',
        amount: new Prisma.Decimal('333.33'),
        postedEcritureId: null,
        fixedAsset: LINEAR_ASSET,
        fiscalYear: FISCAL_YEARS[0],
        ...overrides,
      };
    }

    it('posts through EntriesService.create/validate and records postedEcritureId', async () => {
      prisma.depreciationEntry.findFirst.mockResolvedValue(depreciationEntry());
      prisma.depreciationEntry.findMany.mockResolvedValue([]); // no other posted entries
      prisma.journal.findFirst.mockResolvedValue({ id: 'journal-od', code: 'OD', type: 'OPERATIONS_DIVERSES' });

      const result = await service.postDotation(company, 'entry-1');

      expect(entriesService.create).toHaveBeenCalledWith(
        company,
        expect.objectContaining({
          journalId: 'journal-od',
          fiscalYearId: 'fy-2026',
          lignes: [
            { compteId: EXPENSE_ACCOUNT.id, debit: '333.33' },
            { compteId: DEPRECIATION_ACCOUNT.id, credit: '333.33' },
          ],
        }),
      );
      expect(entriesService.validate).toHaveBeenCalledWith(company, 'draft-1');
      expect(prisma.depreciationEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: { postedEcritureId: 'draft-1' },
      });
      expect((result as unknown as { postedEcritureId: string }).postedEcritureId).toBe('draft-1');
    });

    it('refuses to double-post the same dotation', async () => {
      prisma.depreciationEntry.findFirst.mockResolvedValue(
        depreciationEntry({ postedEcritureId: 'ecriture-already' }),
      );

      await expect(service.postDotation(company, 'entry-1')).rejects.toThrow(ConflictException);
      expect(entriesService.create).not.toHaveBeenCalled();
    });

    it('refuses to post past the depreciable base', async () => {
      prisma.depreciationEntry.findFirst.mockResolvedValue(depreciationEntry());
      prisma.depreciationEntry.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('700.00') }, // already-posted total
      ]);
      // Asset base is 1000.00; 700.00 already posted + this 333.33 entry would exceed it.

      await expect(service.postDotation(company, 'entry-1')).rejects.toThrow(ConflictException);
      expect(entriesService.create).not.toHaveBeenCalled();
    });

    it('refuses when the company has no opérations diverses journal', async () => {
      prisma.depreciationEntry.findFirst.mockResolvedValue(depreciationEntry());
      prisma.depreciationEntry.findMany.mockResolvedValue([]);
      prisma.journal.findFirst.mockResolvedValue(null);

      await expect(service.postDotation(company, 'entry-1')).rejects.toThrow(NotFoundException);
      expect(entriesService.create).not.toHaveBeenCalled();
    });
  });
});
