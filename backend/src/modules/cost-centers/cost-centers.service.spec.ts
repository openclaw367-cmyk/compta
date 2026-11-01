import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CostCentersService } from './cost-centers.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

const FISCAL_YEAR = {
  id: 'fy-1',
  companyId: 'company-1',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  closedAt: null,
};

const CC1 = { id: 'cc-1', companyId: 'company-1', code: 'PROJ-A', label: 'Projet A' };
const CC2 = { id: 'cc-2', companyId: 'company-1', code: 'PROJ-B', label: 'Projet B' };

function makePrismaMock() {
  return {
    fiscalYear: { findFirst: jest.fn().mockResolvedValue(FISCAL_YEAR) },
    costCenter: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([CC1, CC2]),
      findFirst: jest.fn(),
    },
    ecritureLigne: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('CostCentersService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: CostCentersService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new CostCentersService(prisma as unknown as PrismaService);
  });

  it('create() scopes the write to the current company', async () => {
    prisma.costCenter.create.mockResolvedValue(CC1);
    await service.create(company, { code: 'PROJ-A', label: 'Projet A' });
    expect(prisma.costCenter.create).toHaveBeenCalledWith({
      data: { companyId: company.companyId, code: 'PROJ-A', label: 'Projet A' },
    });
  });

  it('findAll() scopes the read to the current company', async () => {
    await service.findAll(company);
    expect(prisma.costCenter.findMany).toHaveBeenCalledWith({
      where: { companyId: company.companyId },
      orderBy: { code: 'asc' },
    });
  });

  it('findOne() throws NotFoundException for an unknown or cross-company id', async () => {
    prisma.costCenter.findFirst.mockResolvedValue(null);
    await expect(service.findOne(company, 'cc-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('computeReport() throws NotFoundException for an unknown or cross-company fiscal year', async () => {
    prisma.fiscalYear.findFirst.mockResolvedValue(null);
    await expect(service.computeReport(company, 'fy-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('computeReport() scopes the ligne fetch to validated-only pcgClass 6/7 lines in the given fiscal year', async () => {
    await service.computeReport(company, 'fy-1');
    expect(prisma.ecritureLigne.findMany).toHaveBeenCalledWith({
      where: {
        companyId: company.companyId,
        ecriture: { fiscalYearId: 'fy-1', validatedAt: { not: null } },
        compte: { pcgClass: { in: [6, 7] } },
      },
      include: { compte: true },
    });
  });

  it('computeReport() feeds computeAnalyticalReport() with the fetched lignes/cost centers and ties out', async () => {
    prisma.ecritureLigne.findMany.mockResolvedValue([
      {
        compte: { number: '607000', pcgClass: 6 },
        debit: new Prisma.Decimal('1000.00'),
        credit: new Prisma.Decimal('0.00'),
        costCenterId: 'cc-1',
      },
      {
        compte: { number: '707000', pcgClass: 7 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('3000.00'),
        costCenterId: 'cc-1',
      },
    ]);
    const report = await service.computeReport(company, 'fy-1');
    expect(report.fiscalYearId).toBe('fy-1');
    const cc1Bucket = report.buckets.find((b) => b.costCenterId === 'cc-1')!;
    expect(cc1Bucket.lines).toEqual(
      expect.arrayContaining([
        { code: 'FS', label: 'Achats de marchandises', amount: '1000.00' },
        { code: 'FC', label: 'Ventes de marchandises', amount: '3000.00' },
      ]),
    );
  });
});
