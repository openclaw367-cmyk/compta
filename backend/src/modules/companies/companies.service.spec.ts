import { NotFoundException } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function makePrismaMock() {
  return {
    company: {
      findUnique: jest.fn().mockResolvedValue({ id: 'company-1', name: 'Société Démo SARL' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn((args: { where: { id: string }; data: unknown }) => ({
        id: args.where.id,
        ...(args.data as object),
      })),
    },
  };
}

describe('CompaniesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: CompaniesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new CompaniesService(prisma as unknown as PrismaService);
  });

  it('updates only the supplied fields on the current company', async () => {
    const result = await service.updateCurrent(company, { city: 'Paris' });
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { city: 'Paris' },
    });
    expect(result).toMatchObject({ id: 'company-1', city: 'Paris' });
  });

  it('rejects an update for a company that no longer exists', async () => {
    prisma.company.findUnique.mockResolvedValueOnce(null);
    await expect(service.updateCurrent(company, { city: 'Paris' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('lists every company, not scoped to one tenant — this is what a company picker chooses from', async () => {
    prisma.company.findMany.mockResolvedValueOnce([
      { id: 'company-1', name: 'Société Démo SARL' },
      { id: 'company-2', name: 'Société Test Multi-Année' },
    ]);
    const result = await service.findAll();
    expect(prisma.company.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'asc' } });
    expect(result).toHaveLength(2);
  });
});
