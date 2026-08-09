import { ConflictException } from '@nestjs/common';
import { Prisma, JournalType } from '@prisma/client';
import { LiasseService } from './liasse.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import {
  FY_2026 as ORACLE_FY_2026,
  ORACLE_ASSETS,
  ORACLE_BILAN_LIGNES,
  ORACLE_DEPRECIATION_ENTRIES,
  ORACLE_HN,
} from './tableau-2054-2055-oracle-fixture';
import { ORACLE_2056_TOTALS } from './tableau-2056-oracle-fixture';

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

  it('wires 2054/2055 end to end on the multi-year oracle — the first real exercise of entry.fiscalYear.endDate', async () => {
    // Reuses the same hand-traced fixture as tableau-2054.spec.ts / tableau-2055.spec.ts /
    // tableau-2054-2055-articulation.spec.ts, this time driven through the actual Prisma-shaped
    // query result (include: { depreciationEntries: { include: { fiscalYear: true } } }) rather
    // than calling the pure compute functions directly — the earlier VNC-bug tests above never
    // populated depreciationEntries, so this is the first test that exercises
    // entry.fiscalYear.endDate at all.
    const entriesByAccount = new Map<string, typeof ORACLE_DEPRECIATION_ENTRIES>();
    for (const entry of ORACLE_DEPRECIATION_ENTRIES) {
      const list = entriesByAccount.get(entry.accountNumber) ?? [];
      list.push(entry);
      entriesByAccount.set(entry.accountNumber, list);
    }
    const fixedAssets: FakeFixedAsset[] = ORACLE_ASSETS.map((asset, i) => ({
      id: `asset-${i}`,
      companyId: company.companyId,
      accountId: `account-${asset.accountNumber}`,
      account: { number: asset.accountNumber },
      acquisitionDate: asset.acquisitionDate,
      acquisitionValue: new Prisma.Decimal(asset.acquisitionValue.toApiString()),
      residualValue: new Prisma.Decimal('0.00'),
      depreciationEntries: (entriesByAccount.get(asset.accountNumber) ?? []).map((entry) => ({
        fiscalYearId: entry.fiscalYearId,
        fiscalYear: { endDate: entry.fiscalYearEndDate },
        amount: new Prisma.Decimal(entry.amount.toApiString()),
        postedEcritureId: 'some-ecriture-id',
      })),
    }));

    const prisma = makePrismaMock(fixedAssets);
    prisma.fiscalYear.findFirst.mockResolvedValue({
      id: ORACLE_FY_2026.id,
      companyId: company.companyId,
      label: '2026',
      startDate: ORACLE_FY_2026.startDate,
      endDate: ORACLE_FY_2026.endDate,
      closedAt: null,
    });
    prisma.ecritureLigne.findMany = jest.fn().mockResolvedValue(
      ORACLE_BILAN_LIGNES.map((l) => ({
        compteId: l.compteNumber,
        compte: { number: l.compteNumber, pcgClass: l.pcgClass },
        debit: l.debit,
        credit: l.credit,
      })),
    );

    const service = new LiasseService(prisma as unknown as PrismaService);
    const result = await service.generate(company, { fiscalYearId: ORACLE_FY_2026.id });

    expect(result.compteResultat.beneficeOuPerte).toBe(ORACLE_HN);
    expect(result.tableau2054.totalGeneral).toBe('390000.00');
    expect(result.tableau2055.totalGeneral).toBe('38600.00');
    expect(
      result.tableau2054.lignes.find((l) => l.code === 'CONSTRUCTIONS_SOL_PROPRE'),
    ).toMatchObject({
      valeurBruteDebut: '200000.00',
      acquisitions: '0.00',
      valeurBruteFin: '200000.00',
    });
    expect(
      result.tableau2055.lignes.find((l) => l.code === 'CONSTRUCTIONS_SOL_PROPRE'),
    ).toMatchObject({ montantDebut: '10000.00', dotations: '10000.00', montantFin: '20000.00' });
    expect(result.bilan.totalActifNet).toBe(result.bilan.totalPassif);
  });

  it('wires 2056 end to end — a fresh provision (dotation + partial reprise) and a fresh dépréciation (dotation only), no immobilisations involved', async () => {
    const prisma = makePrismaMock();
    prisma.fiscalYear.findFirst.mockResolvedValue(FY_2026);
    const nonAn = { journal: { type: JournalType.OPERATIONS_DIVERSES } };
    prisma.ecritureLigne.findMany = jest.fn().mockResolvedValue([
      // Minimal balanced base — capital apport in cash. Deliberately no immobilisation accounts, so
      // tableau2054/2055 (fed by fixedAsset.findMany, left at its default empty mock here) stay
      // trivially 0.00 = 0.00 and don't interfere with this test's actual subject, 2056.
      {
        compteId: '512000',
        compte: { number: '512000', pcgClass: 5 },
        debit: new Prisma.Decimal('10000.00'),
        credit: new Prisma.Decimal('0.00'),
        ecriture: nonAn,
      },
      {
        compteId: '101000',
        compte: { number: '101000', pcgClass: 1 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('10000.00'),
        ecriture: nonAn,
      },
      // Vente à crédit — gives the clients dépréciation below a real receivable to net against.
      {
        compteId: '411000',
        compte: { number: '411000', pcgClass: 4 },
        debit: new Prisma.Decimal('5000.00'),
        credit: new Prisma.Decimal('0.00'),
        ecriture: nonAn,
      },
      {
        compteId: '706000',
        compte: { number: '706000', pcgClass: 7 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('5000.00'),
        ecriture: nonAn,
      },
      // Dotation provisions pour garanties clients.
      {
        compteId: '151200',
        compte: { number: '151200', pcgClass: 1 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('5000.00'),
        ecriture: nonAn,
      },
      {
        compteId: '681500',
        compte: { number: '681500', pcgClass: 6 },
        debit: new Prisma.Decimal('5000.00'),
        credit: new Prisma.Decimal('0.00'),
        ecriture: nonAn,
      },
      // Reprise partielle sur cette même provision.
      {
        compteId: '151200',
        compte: { number: '151200', pcgClass: 1 },
        debit: new Prisma.Decimal('2000.00'),
        credit: new Prisma.Decimal('0.00'),
        ecriture: nonAn,
      },
      {
        compteId: '781000',
        compte: { number: '781000', pcgClass: 7 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('2000.00'),
        ecriture: nonAn,
      },
      // Dotation dépréciation clients douteux.
      {
        compteId: '491000',
        compte: { number: '491000', pcgClass: 4 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('1200.00'),
        ecriture: nonAn,
      },
      {
        compteId: '681700',
        compte: { number: '681700', pcgClass: 6 },
        debit: new Prisma.Decimal('1200.00'),
        credit: new Prisma.Decimal('0.00'),
        ecriture: nonAn,
      },
    ]);

    const service = new LiasseService(prisma as unknown as PrismaService);
    const result = await service.generate(company, { fiscalYearId: FY_2026.id });

    expect(result.tableau2056.totalReglementees).toBe(ORACLE_2056_TOTALS.totalReglementees);
    expect(result.tableau2056.totalRisquesCharges).toBe(ORACLE_2056_TOTALS.totalRisquesCharges);
    expect(result.tableau2056.totalDepreciation).toBe(ORACLE_2056_TOTALS.totalDepreciation);
    expect(result.tableau2056.totalGeneral).toBe(ORACLE_2056_TOTALS.totalGeneral);

    // Bilan side-effects: DP (provisions pour risques) picks up the net 3 000,00; the clients line
    // nets a 5 000,00 receivable against its 1 200,00 dépréciation.
    const dp = result.bilan.passif.find((l) => l.code === 'DP')!;
    expect(dp.montant).toBe('3000.00');
    const clients = result.bilan.actif.find((l) => l.label === 'Clients et comptes rattachés')!;
    expect(clients).toMatchObject({ brut: '5000.00', amortissements: '1200.00', net: '3800.00' });

    expect(result.bilan.totalActifNet).toBe(result.bilan.totalPassif);

    // 2057 reproduces the same 5 000,00 clients brut as its own BX row (no fournisseurs/emprunts/
    // dettes fiscales posted in this fixture, so Cadre B stays entirely at 0,00).
    const bx = result.tableau2057.cadreA.find((l) => l.code === 'BX')!;
    expect(bx.montantBrut).toBe('5000.00');
    expect(result.tableau2057.totalCreances).toBe('5000.00');
    expect(result.tableau2057.totalDettes).toBe('0.00');
  });
});

function service(prisma: ReturnType<typeof makePrismaMock>): LiasseService {
  return new LiasseService(prisma as unknown as PrismaService);
}
