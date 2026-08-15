import { BadRequestException, ConflictException, NotFoundException, NotImplementedException } from '@nestjs/common';
import { DepreciationMethod, Prisma } from '@prisma/client';
import { DepreciationService } from './depreciation.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntriesService } from '../entries/entries.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CessionFixedAssetDto } from './dto/cession-fixed-asset.dto';

/**
 * Oracle: "Camion" — acquired and put into service 2025-01-01,
 * acquisitionValue 12 000,00, usefulLifeYears 4 (annual dotation
 * 3 000,00). FY2025 is a normal, already-posted full year. Disposed
 * 2026-07-01 (mid-year of FY2026).
 *
 *   periodStart = max(FY2026.startDate, serviceStartDate) = 2026-01-01.
 *   daysBetween360(2026-01-01, 2026-07-01) = 6*30 + (1-1) + 1 = 181.
 *   prorated FY2026 dotation = 3000.00 * 181/360 = 1508.33.
 *   amortissementsCumules = 3000.00 (FY2025) + 1508.33 (FY2026) = 4508.33.
 *   VNC = 12000.00 - 4508.33 = 7491.67.
 *
 * Two cessionPrice scenarios: 9000.00 (plus-value 1508.33) and 5000.00
 * (moins-value -2491.67) — see the two "posts the disposal écriture"
 * tests below.
 *
 * The mock Prisma layer here is STATEFUL (a single in-memory
 * depreciationEntry array, mutated by upsert/update, read back by
 * findFirst/findMany) rather than one-shot mockResolvedValue chains —
 * disposeFixedAsset()'s own read-after-its-own-write (it upserts+posts
 * the prorated entry, then re-reads ALL posted entries for the VNC
 * computation) genuinely needs read-your-writes semantics to exercise
 * correctly, the same way a real Postgres connection would give it.
 */
const company: CompanyContext = { companyId: 'company-1' };

const ASSET_ACCOUNT = { id: 'acc-218200', number: '218200', pcgClass: 2 };
const DEPRECIATION_ACCOUNT = { id: 'acc-281820', number: '281820', pcgClass: 2 };
const EXPENSE_ACCOUNT = { id: 'acc-681100', number: '681100', pcgClass: 6 };
const VNC_ACCOUNT = { id: 'acc-675200', number: '675200', pcgClass: 6 };
const PRODUIT_ACCOUNT = { id: 'acc-775200', number: '775200', pcgClass: 7 };
const COMPTE_462 = { id: 'acc-462000', number: '462000', pcgClass: 4 };
const COMPTE_512 = { id: 'acc-512000', number: '512000', pcgClass: 5 };
const COMPTE_411 = { id: 'acc-411000', number: '411000', pcgClass: 4 };

const ALL_ACCOUNTS = [
  ASSET_ACCOUNT,
  DEPRECIATION_ACCOUNT,
  EXPENSE_ACCOUNT,
  VNC_ACCOUNT,
  PRODUIT_ACCOUNT,
  COMPTE_462,
  COMPTE_512,
  COMPTE_411,
];

const FY_2025 = {
  id: 'fy-2025',
  label: '2025',
  startDate: new Date(Date.UTC(2025, 0, 1)),
  endDate: new Date(Date.UTC(2025, 11, 31)),
};
const FY_2026 = {
  id: 'fy-2026',
  label: '2026',
  startDate: new Date(Date.UTC(2026, 0, 1)),
  endDate: new Date(Date.UTC(2026, 11, 31)),
};
const FISCAL_YEARS = [FY_2025, FY_2026];
const fiscalYearsById = new Map(FISCAL_YEARS.map((fy) => [fy.id, fy]));

const ASSET = {
  id: 'asset-camion',
  label: 'Camion',
  method: DepreciationMethod.LINEAR,
  acquisitionValue: new Prisma.Decimal('12000.00'),
  residualValue: new Prisma.Decimal('0.00'),
  usefulLifeYears: 4,
  acquisitionDate: new Date(Date.UTC(2025, 0, 1)),
  serviceStartDate: new Date(Date.UTC(2025, 0, 1)),
  accountId: ASSET_ACCOUNT.id,
  depreciationAccountId: DEPRECIATION_ACCOUNT.id,
  expenseAccountId: EXPENSE_ACCOUNT.id,
  cessionDate: null as Date | null,
  cessionPrice: null as Prisma.Decimal | null,
};

interface MockEntry {
  id: string;
  fixedAssetId: string;
  fiscalYearId: string;
  amount: Prisma.Decimal;
  postedEcritureId: string | null;
}

function makeAccountFindFirst(accounts: { id: string; number: string; pcgClass: number }[]) {
  return jest.fn((args: { where: { id?: string; number?: string } }) => {
    const { id, number } = args.where;
    const found = accounts.find(
      (a) => (id === undefined || a.id === id) && (number === undefined || a.number === number),
    );
    return Promise.resolve(found ?? null);
  });
}

function makeFiscalYearFindFirst() {
  return jest.fn((args: { where: { startDate?: { lte: Date }; endDate?: { gte: Date } } }) => {
    const { startDate, endDate } = args.where;
    const found = FISCAL_YEARS.find(
      (fy) => fy.startDate <= startDate!.lte && fy.endDate >= endDate!.gte,
    );
    return Promise.resolve(found ?? null);
  });
}

function makeFiscalYearFindMany() {
  return jest.fn((args: { where: { startDate?: { gte: Date }; endDate?: { lt: Date } } }) => {
    const { startDate, endDate } = args.where;
    return Promise.resolve(
      FISCAL_YEARS.filter(
        (fy) => (!startDate || fy.startDate >= startDate.gte) && (!endDate || fy.endDate < endDate.lt),
      ),
    );
  });
}

/** Stateful depreciationEntry mock — one shared mutable array backs findFirst/findMany/upsert/update. */
function makeDepreciationEntryMock(initialEntries: MockEntry[]) {
  const entries: MockEntry[] = [...initialEntries];
  let autoId = 0;

  const findFirst = jest.fn(
    (args: { where: { id?: string; fixedAssetId?: string; fiscalYearId?: string; companyId?: string } }) => {
      const { id, fixedAssetId, fiscalYearId } = args.where;
      const entry = id
        ? entries.find((e) => e.id === id)
        : entries.find((e) => e.fixedAssetId === fixedAssetId && e.fiscalYearId === fiscalYearId);
      if (!entry) {
        return Promise.resolve(null);
      }
      // Mirrors postDotation's `include: { fixedAsset: true, fiscalYear: true }`.
      return Promise.resolve({ ...entry, fixedAsset: ASSET, fiscalYear: fiscalYearsById.get(entry.fiscalYearId) });
    },
  );

  const findMany = jest.fn(
    (args: {
      where: { fixedAssetId?: string; fiscalYearId?: { in: string[] }; postedEcritureId?: unknown };
    }) => {
      let result = entries;
      if (args.where.fixedAssetId) {
        result = result.filter((e) => e.fixedAssetId === args.where.fixedAssetId);
      }
      if (args.where.fiscalYearId) {
        result = result.filter((e) => args.where.fiscalYearId!.in.includes(e.fiscalYearId));
      }
      if (args.where.postedEcritureId) {
        result = result.filter((e) => e.postedEcritureId !== null);
      }
      return Promise.resolve(result.map((e) => ({ ...e })));
    },
  );

  const upsert = jest.fn(
    (args: {
      where: { fixedAssetId_fiscalYearId: { fixedAssetId: string; fiscalYearId: string } };
      create: { fixedAssetId: string; fiscalYearId: string; amount: Prisma.Decimal };
      update: { amount: Prisma.Decimal };
    }) => {
      const { fixedAssetId, fiscalYearId } = args.where.fixedAssetId_fiscalYearId;
      let entry = entries.find((e) => e.fixedAssetId === fixedAssetId && e.fiscalYearId === fiscalYearId);
      if (entry) {
        entry.amount = args.update.amount;
      } else {
        autoId += 1;
        entry = { id: `entry-auto-${autoId}`, fixedAssetId, fiscalYearId, amount: args.create.amount, postedEcritureId: null };
        entries.push(entry);
      }
      return Promise.resolve({ ...entry });
    },
  );

  const update = jest.fn((args: { where: { id: string }; data: { postedEcritureId: string } }) => {
    const entry = entries.find((e) => e.id === args.where.id);
    if (entry) {
      entry.postedEcritureId = args.data.postedEcritureId;
    }
    return Promise.resolve({ ...entry });
  });

  return { findFirst, findMany, upsert, update };
}

function makePrismaMock(overrides: { postedEntries?: MockEntry[] } = {}) {
  const postedEntries =
    overrides.postedEntries ?? [
      { id: 'entry-2025', fixedAssetId: ASSET.id, fiscalYearId: FY_2025.id, amount: new Prisma.Decimal('3000.00'), postedEcritureId: 'ecriture-2025' },
    ];
  return {
    fixedAsset: {
      findFirst: jest.fn().mockResolvedValue(ASSET),
      update: jest.fn((args: { data: unknown }) => Promise.resolve({ ...ASSET, ...(args.data as object) })),
    },
    account: { findFirst: makeAccountFindFirst(ALL_ACCOUNTS) },
    fiscalYear: { findFirst: makeFiscalYearFindFirst(), findMany: makeFiscalYearFindMany() },
    depreciationEntry: makeDepreciationEntryMock(postedEntries),
    journal: {
      findFirst: jest.fn().mockResolvedValue({ id: 'journal-od', code: 'OD', type: 'OPERATIONS_DIVERSES' }),
    },
    ecriture: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function makeEntriesServiceMock() {
  let counter = 0;
  return {
    create: jest.fn().mockImplementation(() => {
      counter += 1;
      return Promise.resolve({ id: `draft-${counter}`, validatedAt: null });
    }),
    validate: jest.fn().mockImplementation((_company: unknown, id: string) =>
      Promise.resolve({ id, ecritureNum: id === 'draft-1' ? '10' : '11', validatedAt: new Date() }),
    ),
  };
}

function cessionDto(overrides: Partial<CessionFixedAssetDto> = {}): CessionFixedAssetDto {
  return { cessionDate: '2026-07-01', cessionPrice: '9000.00', ...overrides };
}

describe('DepreciationService.disposeFixedAsset', () => {
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

  it('posts the prorated final dotation, then the disposal écriture — plus-value case', async () => {
    const result = await service.disposeFixedAsset(company, ASSET.id, cessionDto());

    // Step 1: prorated final dotation, through postDotation()'s own EntriesService.create/validate.
    expect(entriesService.create).toHaveBeenNthCalledWith(
      1,
      company,
      expect.objectContaining({
        fiscalYearId: FY_2026.id,
        lignes: [
          { compteId: EXPENSE_ACCOUNT.id, debit: '1508.33' },
          { compteId: DEPRECIATION_ACCOUNT.id, credit: '1508.33' },
        ],
      }),
    );
    expect(result.finalDotationEcritureNum).toBe('10');

    // Step 2: the disposal écriture itself.
    expect(entriesService.create).toHaveBeenNthCalledWith(
      2,
      company,
      expect.objectContaining({
        fiscalYearId: FY_2026.id,
        ecritureDate: '2026-07-01',
        lignes: [
          { compteId: DEPRECIATION_ACCOUNT.id, debit: '4508.33' },
          { compteId: VNC_ACCOUNT.id, debit: '7491.67' },
          { compteId: ASSET_ACCOUNT.id, credit: '12000.00' },
          { compteId: COMPTE_462.id, debit: '9000.00' },
          { compteId: PRODUIT_ACCOUNT.id, credit: '9000.00' },
        ],
      }),
    );
    expect(result.cessionEcritureNum).toBe('11');
    expect(result.vnc).toBe('7491.67');
    expect(result.plusOuMoinsValue).toBe('1508.33'); // 9000.00 - 7491.67

    // FixedAsset marked disposed on the same row.
    expect(prisma.fixedAsset.update).toHaveBeenCalledWith({
      where: { id: ASSET.id },
      data: { cessionDate: new Date('2026-07-01'), cessionPrice: expect.anything() },
    });
  });

  it('posts a moins-value correctly when cessionPrice is below VNC', async () => {
    const result = await service.disposeFixedAsset(company, ASSET.id, cessionDto({ cessionPrice: '5000.00' }));
    expect(result.plusOuMoinsValue).toBe('-2491.67'); // 5000.00 - 7491.67
  });

  it('omits the produit/règlement lines entirely for a 0,00 disposal (mise au rebut)', async () => {
    await service.disposeFixedAsset(company, ASSET.id, cessionDto({ cessionPrice: '0.00' }));
    expect(entriesService.create).toHaveBeenNthCalledWith(
      2,
      company,
      expect.objectContaining({
        lignes: [
          { compteId: DEPRECIATION_ACCOUNT.id, debit: '4508.33' },
          { compteId: VNC_ACCOUNT.id, debit: '7491.67' },
          { compteId: ASSET_ACCOUNT.id, credit: '12000.00' },
        ],
      }),
    );
  });

  it('accepts a caller-supplied compteReglementId (immediate cash, class 5) instead of the 462 default', async () => {
    await service.disposeFixedAsset(
      company,
      ASSET.id,
      cessionDto({ compteReglementId: COMPTE_512.id }),
    );
    expect(entriesService.create).toHaveBeenNthCalledWith(
      2,
      company,
      expect.objectContaining({
        lignes: expect.arrayContaining([{ compteId: COMPTE_512.id, debit: '9000.00' }]),
      }),
    );
  });

  it('rejects a caller-supplied compteReglementId that is neither 462 nor class 5', async () => {
    await expect(
      service.disposeFixedAsset(company, ASSET.id, cessionDto({ compteReglementId: COMPTE_411.id })),
    ).rejects.toThrow(BadRequestException);
    expect(entriesService.create).not.toHaveBeenCalled();
  });

  it('refuses an asset already disposed', async () => {
    prisma.fixedAsset.findFirst.mockResolvedValue({
      ...ASSET,
      cessionDate: new Date('2026-03-01'),
      cessionPrice: new Prisma.Decimal('1.00'),
    });
    await expect(service.disposeFixedAsset(company, ASSET.id, cessionDto())).rejects.toThrow(
      ConflictException,
    );
    expect(entriesService.create).not.toHaveBeenCalled();
  });

  it('refuses a cessionDate before serviceStartDate', async () => {
    await expect(
      service.disposeFixedAsset(company, ASSET.id, cessionDto({ cessionDate: '2024-01-01' })),
    ).rejects.toThrow(BadRequestException);
    expect(entriesService.create).not.toHaveBeenCalled();
  });

  it('refuses a negative cessionPrice', async () => {
    await expect(
      service.disposeFixedAsset(company, ASSET.id, cessionDto({ cessionPrice: '-1.00' })),
    ).rejects.toThrow(BadRequestException);
    expect(entriesService.create).not.toHaveBeenCalled();
  });

  it('refuses when no fiscal year covers cessionDate', async () => {
    await expect(
      service.disposeFixedAsset(company, ASSET.id, cessionDto({ cessionDate: '2030-01-01' })),
    ).rejects.toThrow(NotFoundException);
    expect(entriesService.create).not.toHaveBeenCalled();
  });

  it('refuses when a prior fiscal year has no posted dotation — VNC would be understated', async () => {
    prisma = makePrismaMock({ postedEntries: [] }); // FY2025 never posted
    service = new DepreciationService(
      prisma as unknown as PrismaService,
      entriesService as unknown as EntriesService,
    );
    await expect(service.disposeFixedAsset(company, ASSET.id, cessionDto())).rejects.toThrow(
      ConflictException,
    );
    expect(entriesService.create).not.toHaveBeenCalled();
  });

  it('refuses when the disposal year was already posted at the wrong (full-year) amount', async () => {
    prisma = makePrismaMock({
      postedEntries: [
        { id: 'entry-2025', fixedAssetId: ASSET.id, fiscalYearId: FY_2025.id, amount: new Prisma.Decimal('3000.00'), postedEcritureId: 'ecriture-2025' },
        { id: 'entry-2026-full', fixedAssetId: ASSET.id, fiscalYearId: FY_2026.id, amount: new Prisma.Decimal('3000.00'), postedEcritureId: 'ecriture-wrong' },
      ],
    });
    service = new DepreciationService(
      prisma as unknown as PrismaService,
      entriesService as unknown as EntriesService,
    );
    await expect(service.disposeFixedAsset(company, ASSET.id, cessionDto())).rejects.toThrow(
      ConflictException,
    );
    expect(entriesService.create).not.toHaveBeenCalled();
  });

  it('rejects a financière (26x/27x) asset account as not implemented', async () => {
    prisma.fixedAsset.findFirst.mockResolvedValue({ ...ASSET, accountId: 'acc-261000' });
    prisma.account.findFirst = makeAccountFindFirst([
      ...ALL_ACCOUNTS,
      { id: 'acc-261000', number: '261000', pcgClass: 2 },
    ]);
    await expect(service.disposeFixedAsset(company, ASSET.id, cessionDto())).rejects.toThrow(
      NotImplementedException,
    );
    expect(entriesService.create).not.toHaveBeenCalled();
  });

  it('requires the 675x/775x accounts to already exist — never auto-creates them', async () => {
    prisma.account.findFirst = makeAccountFindFirst(ALL_ACCOUNTS.filter((a) => a.number !== '675200'));
    await expect(service.disposeFixedAsset(company, ASSET.id, cessionDto())).rejects.toThrow(
      NotFoundException,
    );
    expect(entriesService.create).not.toHaveBeenCalled();
  });

  it("skips proration when disposal lands exactly on the fiscal year's own last day (full annual amount)", async () => {
    // FY2025 fully posted; disposing on 2026-12-31 needs the *full* annual amount (not prorated
    // down) — computeFinalPeriodDotation naturally returns 3000.00 since
    // daysBetween360(2026-01-01, 2026-12-31) = 360.
    await service.disposeFixedAsset(company, ASSET.id, cessionDto({ cessionDate: '2026-12-31' }));
    expect(entriesService.create).toHaveBeenNthCalledWith(
      1,
      company,
      expect.objectContaining({
        lignes: [
          { compteId: EXPENSE_ACCOUNT.id, debit: '3000.00' },
          { compteId: DEPRECIATION_ACCOUNT.id, credit: '3000.00' },
        ],
      }),
    );
  });
});
