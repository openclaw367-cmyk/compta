import { ConflictException } from '@nestjs/common';
import { FiscalYearsService } from './fiscal-years.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function makePrismaMock() {
  return {
    fiscalYear: {
      findFirst: jest.fn().mockResolvedValue({ id: 'fy-1', label: '2026', closedAt: null }),
      update: jest.fn((args: { where: { id: string }; data: unknown }) => ({
        id: args.where.id,
        ...(args.data as object),
      })),
    },
    ecriture: { count: jest.fn().mockResolvedValue(0) },
  };
}

describe('FiscalYearsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: FiscalYearsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new FiscalYearsService(prisma as unknown as PrismaService);
  });

  it('closes a fiscal year with no draft écritures', async () => {
    const result = await service.close(company, 'fy-1');
    expect(prisma.ecriture.count).toHaveBeenCalledWith({
      where: { companyId: company.companyId, fiscalYearId: 'fy-1', validatedAt: null },
    });
    expect(prisma.fiscalYear.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fy-1' }, data: { closedAt: expect.any(Date) } }),
    );
    expect(result).toBeDefined();
  });

  it('refuses to close a fiscal year with draft écritures, naming how many remain', async () => {
    prisma.ecriture.count.mockResolvedValue(3);
    await expect(service.close(company, 'fy-1')).rejects.toThrow(ConflictException);
    await expect(service.close(company, 'fy-1')).rejects.toThrow(/3 écriture/);
    expect(prisma.fiscalYear.update).not.toHaveBeenCalled();
  });

  it('refuses to close an already-closed fiscal year', async () => {
    prisma.fiscalYear.findFirst.mockResolvedValueOnce({
      id: 'fy-1',
      label: '2026',
      closedAt: new Date(),
    });
    await expect(service.close(company, 'fy-1')).rejects.toThrow(ConflictException);
    expect(prisma.ecriture.count).not.toHaveBeenCalled();
  });
});
