import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LiasseService } from './liasse.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

const FY_2026 = {
  id: 'fy-2026',
  companyId: company.companyId,
  label: '2026',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  closedAt: new Date('2027-01-01'),
};

interface FakeFixedAsset {
  id: string;
  companyId: string;
  accountId: string;
  account: { number: string };
  acquisitionDate: Date;
  acquisitionValue: Prisma.Decimal;
  residualValue: Prisma.Decimal;
  depreciationEntries: unknown[];
}

/**
 * A "smart" fixedAsset.findMany mock: it actually applies the
 * acquisitionDate filter from the `where` clause it receives, the same
 * way Postgres would — rather than just returning a fixed list
 * regardless of the query. This is what makes the regression test
 * below meaningfully exercise the fix: against the pre-fix code (no
 * acquisitionDate in the where clause), this mock would return every
 * asset regardless of date, reproducing the bug.
 */
function makeFixedAssetFindMany(assets: FakeFixedAsset[]) {
  return jest.fn((args: { where?: { acquisitionDate?: { lte?: Date } } }) => {
    const lte = args?.where?.acquisitionDate?.lte;
    const filtered = lte ? assets.filter((a) => a.acquisitionDate <= lte) : assets;
    return Promise.resolve(filtered);
  });
}

function makePrismaMock(fixedAssets: FakeFixedAsset[] = []) {
  return {
    company: {
      findFirst: jest.fn().mockResolvedValue({ id: company.companyId, regime: 'REEL_NORMAL' }),
    },
    fiscalYear: { findFirst: jest.fn().mockResolvedValue(FY_2026) },
    ecriture: { count: jest.fn().mockResolvedValue(0) },
    ecritureLigne: { findMany: jest.fn().mockResolvedValue([]) },
    fixedAsset: { findMany: makeFixedAssetFindMany(fixedAssets) },
  };
}

describe('LiasseService.generate', () => {
  it('excludes a FixedAsset acquired in a LATER fiscal year from the VNC when reporting a past closed year', async () => {
    // Asset A: acquired within FY2026, must count toward FY2026's VNC.
    // Asset B: acquired in 2027, AFTER FY2026 ends — reporting FY2026's liasse must not see it at
    // all, exactly the bug found while designing 2054's movement logic (liasse.service.ts's
    // buildVncByLine filtered depreciationEntries by fiscal year but not the assets themselves).
    const assetA: FakeFixedAsset = {
      id: 'asset-a',
      companyId: company.companyId,
      accountId: 'account-218300',
      account: { number: '218300' },
      acquisitionDate: new Date('2026-01-15'),
      acquisitionValue: new Prisma.Decimal('1000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      depreciationEntries: [],
    };
    const assetB: FakeFixedAsset = {
      id: 'asset-b',
      companyId: company.companyId,
      accountId: 'account-218300',
      account: { number: '218300' },
      acquisitionDate: new Date('2027-03-01'),
      acquisitionValue: new Prisma.Decimal('5000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      depreciationEntries: [],
    };

    const prisma = makePrismaMock([assetA, assetB]);
    // The FY2026 ledger only ever contains FY2026's own écritures — asset B's 2027 acquisition
    // was never posted here, so the ledger-derived Actif already correctly reflects only asset A.
    prisma.ecritureLigne.findMany = jest.fn().mockResolvedValue([
      {
        compteId: 'account-218300',
        compte: { number: '218300', pcgClass: 2 },
        debit: new Prisma.Decimal('1000.00'),
        credit: new Prisma.Decimal('0.00'),
      },
      {
        compteId: 'account-101000',
        compte: { number: '101000', pcgClass: 1 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('1000.00'),
      },
    ]);

    const service = new LiasseService(prisma as unknown as PrismaService);
    const result = await service.generate(company, { fiscalYearId: FY_2026.id });

    const at = result.bilan.actif.find((l) => l.code === 'AT')!;
    expect(at.brut).toBe('1000.00'); // asset A only — asset B never leaked in
    expect(at.net).toBe('1000.00');
    expect(result.bilan.totalActifNet).toBe(result.bilan.totalPassif);
  });

  it('would have caught the bug: an unfiltered asset query throws on the VNC/ledger mismatch', async () => {
    // Same fixtures as above, but this time the mock ignores the acquisitionDate filter entirely —
    // simulating what the pre-fix query behavior effectively was. This is the failure mode the fix
    // closes: asset B's value leaking into a period it doesn't belong to must be refused, not
    // silently accepted.
    const assetA: FakeFixedAsset = {
      id: 'asset-a',
      companyId: company.companyId,
      accountId: 'account-218300',
      account: { number: '218300' },
      acquisitionDate: new Date('2026-01-15'),
      acquisitionValue: new Prisma.Decimal('1000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      depreciationEntries: [],
    };
    const assetB: FakeFixedAsset = {
      id: 'asset-b',
      companyId: company.companyId,
      accountId: 'account-218300',
      account: { number: '218300' },
      acquisitionDate: new Date('2027-03-01'),
      acquisitionValue: new Prisma.Decimal('5000.00'),
      residualValue: new Prisma.Decimal('0.00'),
      depreciationEntries: [],
    };

    const prisma = makePrismaMock([assetA, assetB]);
    prisma.fixedAsset.findMany = jest.fn().mockResolvedValue([assetA, assetB]); // ignores the where clause, pre-fix-shaped
    prisma.ecritureLigne.findMany = jest.fn().mockResolvedValue([
      {
        compteId: 'account-218300',
        compte: { number: '218300', pcgClass: 2 },
        debit: new Prisma.Decimal('1000.00'),
        credit: new Prisma.Decimal('0.00'),
      },
      {
        compteId: 'account-101000',
        compte: { number: '101000', pcgClass: 1 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('1000.00'),
      },
    ]);

    const service = new LiasseService(prisma as unknown as PrismaService);
    await expect(service.generate(company, { fiscalYearId: FY_2026.id })).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuses to compute while a draft écriture exists in the fiscal year', async () => {
    const prisma = makePrismaMock();
    prisma.ecriture.count.mockResolvedValue(2);
    await expect(service(prisma).generate(company, { fiscalYearId: FY_2026.id })).rejects.toThrow(
      /2 écriture/,
    );
  });

  it('refuses a REEL_SIMPLIFIE company', async () => {
    const prisma = makePrismaMock();
    prisma.company.findFirst.mockResolvedValue({ id: company.companyId, regime: 'REEL_SIMPLIFIE' });
    await expect(service(prisma).generate(company, { fiscalYearId: FY_2026.id })).rejects.toThrow(
      /not implemented/,
    );
  });
});

function service(prisma: ReturnType<typeof makePrismaMock>): LiasseService {
  return new LiasseService(prisma as unknown as PrismaService);
}
