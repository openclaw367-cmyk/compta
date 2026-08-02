import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VatService } from './vat.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function makePrismaMock() {
  return {
    ecriture: { count: jest.fn().mockResolvedValue(0) },
    ecritureLigne: { findMany: jest.fn().mockResolvedValue([]) },
    vatRate: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('VatService.computeDeclaration', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: VatService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new VatService(prisma as unknown as PrismaService);
  });

  it('refuses to compute while a draft écriture exists in the period', async () => {
    prisma.ecriture.count.mockResolvedValue(2);
    await expect(
      service.computeDeclaration(company, { periodStart: '2026-01-01', periodEnd: '2026-01-31' }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.computeDeclaration(company, { periodStart: '2026-01-01', periodEnd: '2026-01-31' }),
    ).rejects.toThrow(/2 écriture/);
    expect(prisma.ecritureLigne.findMany).not.toHaveBeenCalled();
  });

  it('scopes the lignes query to validated écritures within the period, company-scoped', async () => {
    await service.computeDeclaration(company, { periodStart: '2026-01-01', periodEnd: '2026-01-31' });

    expect(prisma.ecriture.count).toHaveBeenCalledWith({
      where: {
        companyId: company.companyId,
        ecritureDate: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
        validatedAt: null,
      },
    });
    expect(prisma.ecritureLigne.findMany).toHaveBeenCalledWith({
      where: {
        companyId: company.companyId,
        ecriture: {
          ecritureDate: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
          validatedAt: { not: null },
        },
      },
      include: { compte: true },
    });
    expect(prisma.vatRate.findMany).toHaveBeenCalledWith({ where: { companyId: company.companyId } });
  });

  it('delegates the fetched data to computeCa3Declaration and returns its result', async () => {
    prisma.ecritureLigne.findMany.mockResolvedValue([
      {
        compteId: 'account-707',
        compte: { number: '707000', pcgClass: 7 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('100.00'),
        vatRateId: 'rate-20',
      },
      {
        compteId: 'account-44571',
        compte: { number: '445710', pcgClass: 4 },
        debit: new Prisma.Decimal('0.00'),
        credit: new Prisma.Decimal('20.00'),
        vatRateId: 'rate-20',
      },
    ]);
    prisma.vatRate.findMany.mockResolvedValue([
      { id: 'rate-20', ratePercent: new Prisma.Decimal('20.00') },
    ]);

    const result = await service.computeDeclaration(company, {
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
    });

    expect(result.ligne16).toBe('20.00');
    expect(result.ligneTD).toBe('20.00');
    expect(result.collecteeByRate.find((r) => r.ligne === '08')?.baseHT).toBe('100.00');
  });
});
