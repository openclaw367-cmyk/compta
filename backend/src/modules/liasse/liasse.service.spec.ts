import { ConflictException } from '@nestjs/common';
import { Prisma, JournalType } from '@prisma/client';
import { LiasseResult, LiasseService, LiasseSimplifieResult } from './liasse.service';
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

/** Every test in this file exercises the REEL_NORMAL company — narrows the union for property access. */
function asReelNormal(result: LiasseResult | LiasseSimplifieResult): LiasseResult {
  if (result.regime !== 'REEL_NORMAL') {
    throw new Error(`Expected a REEL_NORMAL result, got ${result.regime}`);
  }
  return result;
}

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
  cessionDate?: Date | null;
  cessionPrice?: Prisma.Decimal | null;
}

/**
 * A "smart" fixedAsset.findMany mock: it actually applies the
 * acquisitionDate AND cessionDate filters from the `where` clause it
 * receives, the same way Postgres would — rather than just returning a
 * fixed list regardless of the query. This is what makes the regression
 * tests below meaningfully exercise the fix: against pre-fix code (no
 * acquisitionDate/cessionDate filtering in the where clause), this mock
 * would return every asset regardless of date, reproducing the bug.
 */
function makeFixedAssetFindMany(assets: FakeFixedAsset[]) {
  return jest.fn(
    (args: {
      where?: { acquisitionDate?: { lte?: Date }; OR?: { cessionDate?: { gte?: Date } | null }[] };
    }) => {
      const lte = args?.where?.acquisitionDate?.lte;
      let filtered = lte ? assets.filter((a) => a.acquisitionDate <= lte) : assets;
      const cessionGte = args?.where?.OR?.find((c) => c.cessionDate && 'gte' in c.cessionDate)
        ?.cessionDate as { gte: Date } | undefined;
      if (cessionGte) {
        filtered = filtered.filter((a) => !a.cessionDate || a.cessionDate >= cessionGte.gte);
      }
      return Promise.resolve(
        filtered.map((a) => ({ cessionDate: null, cessionPrice: null, ...a })),
      );
    },
  );
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
    const result = asReelNormal(await service.generate(company, { fiscalYearId: FY_2026.id }));

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

  it('wires the REEL_SIMPLIFIE (2033-A/2033-B) path end to end on the same oracle dataset the REEL_NORMAL path uses', async () => {
    // Reuses this file's own ORACLE_BILAN_LIGNES/ORACLE_HN (tableau-2054-2055-oracle-fixture.ts —
    // despite the name, it's the FULL ledger including the class-6 dotations, same as the "wires
    // 2054/2055" test above feeds it) — a real ecritureLigne.findMany call returns every validated
    // line regardless of class; LiasseService.generate() itself splits by pcgClass.
    //
    // Hand-derived: class-2 net (immobilisations − amortissements) = 390000.00 − 38600.00 =
    // 351400.00; class-5 net (512000) = 100000 − 80000 − 6000 = 14000.00 (débit, cash) — the '028'
    // and '084' 2033-A lines respectively. totalActifNet = 351400 + 14000 = 365400.00. Passif: 120
    // (101000, capital) = 385000.00; resultatDeLExercice = ORACLE_HN = -19600.00 (from 681100's
    // 19600.00 total dotations, the fixture's only charge). totalPassif = 385000 − 19600 =
    // 365400.00 — balances, matching totalActifNet.
    const prisma = makePrismaMock();
    prisma.company.findFirst.mockResolvedValue({ id: company.companyId, regime: 'REEL_SIMPLIFIE' });
    prisma.ecritureLigne.findMany = jest.fn().mockResolvedValue(
      ORACLE_BILAN_LIGNES.map((l) => ({
        compteId: l.compteNumber,
        compte: { number: l.compteNumber, pcgClass: l.pcgClass },
        debit: l.debit,
        credit: l.credit,
      })),
    );

    const result = await service(prisma).generate(company, { fiscalYearId: FY_2026.id });

    if (result.regime !== 'REEL_SIMPLIFIE') {
      throw new Error(`Expected REEL_SIMPLIFIE, got ${result.regime}`);
    }
    expect(result.compteResultat.beneficeOuPerte).toBe(ORACLE_HN);
    expect(result.bilan.resultatDeLExercice).toBe(ORACLE_HN);
    expect(result.bilan.totalActifNet).toBe('365400.00');
    expect(result.bilan.totalPassif).toBe('365400.00');
    // fixedAsset.findMany must never be queried on the simplifié path — no 2033-C this pass.
    expect(prisma.fixedAsset.findMany).not.toHaveBeenCalled();
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
    const result = asReelNormal(
      await service.generate(company, { fiscalYearId: ORACLE_FY_2026.id }),
    );

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

  it('wires a real disposal end to end — 2054 cessions, 2055 diminutions, and 2059-A all agree, Actif=Passif still holds', async () => {
    // Machine D (215400) disposed exactly on FY2026's own last day, cessionPrice 25000.00 — no
    // extra prorated dotation needed since the base oracle's own FY2026 dotation (3000.00) already
    // covers the full year. VNC at disposal = 30000.00 (valeurBrute) - 6000.00
    // (amortissementsCumules: 3000 début + 3000 FY2026 dotation) = 24000.00. Plus-value = 25000.00
    // - 24000.00 = 1000.00.
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
      cessionDate: asset.accountNumber === '215400' ? new Date('2026-12-31') : null,
      cessionPrice: asset.accountNumber === '215400' ? new Prisma.Decimal('25000.00') : null,
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
    // Same ORACLE_BILAN_LIGNES base, plus the disposal's own écriture: débit 281540 6000.00 + débit
    // 675200 24000.00 = crédit 215400 30000.00 (sortie), débit 512000 25000.00 = crédit 775200
    // 25000.00 (produit de cession).
    prisma.ecritureLigne.findMany = jest.fn().mockResolvedValue([
      ...ORACLE_BILAN_LIGNES.map((l) => ({
        compteId: l.compteNumber,
        compte: { number: l.compteNumber, pcgClass: l.pcgClass },
        debit: l.debit,
        credit: l.credit,
      })),
      {
        compteId: '281540',
        compte: { number: '281540', pcgClass: 2 },
        debit: new Prisma.Decimal('6000.00'),
        credit: new Prisma.Decimal('0.00'),
      },
      {
        compteId: '675200',
        compte: { number: '675200', pcgClass: 6 },
        debit: new Prisma.Decimal('24000.00'),
        credit: new Prisma.Decimal('0.00'),
      },
      {
        compteId: '215400',
        compte: { number: '215400', pcgClass: 2 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('30000.00'),
      },
      {
        compteId: '512000',
        compte: { number: '512000', pcgClass: 5 },
        debit: new Prisma.Decimal('25000.00'),
        credit: new Prisma.Decimal('0.00'),
      },
      {
        compteId: '775200',
        compte: { number: '775200', pcgClass: 7 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('25000.00'),
      },
    ]);

    const service = new LiasseService(prisma as unknown as PrismaService);
    const result = asReelNormal(
      await service.generate(company, { fiscalYearId: ORACLE_FY_2026.id }),
    );

    expect(
      result.tableau2054.lignes.find((l) => l.code === 'INSTALLATIONS_TECHNIQUES'),
    ).toMatchObject({
      valeurBruteDebut: '30000.00',
      acquisitions: '0.00',
      cessions: '30000.00',
      valeurBruteFin: '0.00',
    });
    expect(result.tableau2054.totalGeneral).toBe('360000.00'); // 390000.00 - 30000.00

    expect(
      result.tableau2055.lignes.find((l) => l.code === 'INSTALLATIONS_TECHNIQUES'),
    ).toMatchObject({
      montantDebut: '3000.00',
      dotations: '3000.00',
      diminutions: '6000.00',
      montantFin: '0.00',
    });
    expect(result.tableau2055.totalGeneral).toBe('32600.00'); // 38600.00 - 6000.00

    expect(result.tableau2059.cadreA).toEqual([
      {
        accountNumber: '215400',
        valeurOrigine: '30000.00',
        amortissements: '6000.00',
        valeurResiduelle: '24000.00',
      },
    ]);
    expect(result.tableau2059.cadreB).toEqual([
      {
        accountNumber: '215400',
        prixDeVente: '25000.00',
        plusOuMoinsValue: '1000.00',
        qualification: null,
      },
    ]);
    expect(result.tableau2059.totalNonQualifie).toBe('1000.00');

    // The disposed asset's account is fully zeroed out of the bilan — Actif=Passif still holds with
    // Machine D's old 24000.00 net contribution gone and the 25000.00 cash/plus-value flowing
    // through instead.
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
    const result = asReelNormal(await service.generate(company, { fiscalYearId: FY_2026.id }));

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
