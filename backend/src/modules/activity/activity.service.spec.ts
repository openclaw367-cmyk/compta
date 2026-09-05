import { ActivityService } from './activity.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

function makePrismaMock() {
  return {
    activityEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('ActivityService', () => {
  describe('log', () => {
    it('records an event with the given type/actor/target/detail', async () => {
      const prisma = makePrismaMock();
      const service = new ActivityService(prisma as unknown as PrismaService);

      await service.log(company, 'MEMBER_INVITED', 'owner@example.com', {
        targetEmail: 'new@example.com',
      });

      expect(prisma.activityEvent.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          type: 'MEMBER_INVITED',
          actorEmail: 'owner@example.com',
          targetEmail: 'new@example.com',
          detail: null,
        },
      });
    });

    it('never throws — a logging failure must not break the action it describes', async () => {
      const prisma = makePrismaMock();
      prisma.activityEvent.create.mockRejectedValue(new Error('db down'));
      const service = new ActivityService(prisma as unknown as PrismaService);

      await expect(
        service.log(company, 'MEMBER_REMOVED', 'owner@example.com'),
      ).resolves.toBeUndefined();
    });
  });

  describe('listRecent', () => {
    it('lists events for the company, most recent first, capped at 20', async () => {
      const prisma = makePrismaMock();
      const service = new ActivityService(prisma as unknown as PrismaService);

      await service.listRecent(company);

      expect(prisma.activityEvent.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    });
  });
});
