import { NotFoundException } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { PCG_ACCOUNTS, JOURNALS } from '../../common/pcg/pcg-accounts';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

function makePrismaMock() {
  const tx = {
    company: {
      create: jest.fn().mockResolvedValue({ id: 'new-company-1', name: 'Nouvelle société' }),
    },
    account: {
      createMany: jest.fn().mockResolvedValue({ count: PCG_ACCOUNTS.length }),
    },
    journal: {
      createMany: jest.fn().mockResolvedValue({ count: JOURNALS.length }),
    },
    membership: {
      create: jest.fn().mockResolvedValue({ id: 'membership-1' }),
    },
  };
  return {
    company: {
      findUnique: jest.fn().mockResolvedValue({ id: 'company-1', name: 'Société Démo SARL' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn((args: { where: { id: string }; data: unknown }) => ({
        id: args.where.id,
        ...(args.data as object),
      })),
    },
    membership: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Interactive-transaction mock: hands the callback the same tx client
    // every real Prisma transaction would, so create()'s three calls can
    // be asserted on `tx` directly rather than guessing $transaction's
    // own internal shape.
    $transaction: jest.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
    tx,
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

  it('lists every company the given user is a member of, with their own role on each — never a global list', async () => {
    prisma.membership.findMany.mockResolvedValueOnce([
      { role: 'OWNER', company: { id: 'company-1', name: 'Société Démo SARL' } },
      { role: 'READ_ONLY', company: { id: 'company-2', name: 'Société Test Multi-Année' } },
    ] as never);
    const result = await service.findAllForUser('user-1');
    expect(prisma.membership.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      include: { company: true },
      orderBy: { company: { createdAt: 'asc' } },
    });
    expect(result).toEqual([
      { id: 'company-1', name: 'Société Démo SARL', role: 'OWNER' },
      { id: 'company-2', name: 'Société Test Multi-Année', role: 'READ_ONLY' },
    ]);
  });

  describe('create', () => {
    it('scaffolds the full standard chart of accounts and all five journals for the new company, in one transaction', async () => {
      const result = await service.create({ name: 'Nouvelle société', jurisdiction: 'FR' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.tx.company.create).toHaveBeenCalledWith({
        data: { name: 'Nouvelle société', jurisdiction: 'FR' },
      });

      const accountCall = prisma.tx.account.createMany.mock.calls[0][0] as {
        data: { companyId: string; number: string; label: string; pcgClass: number }[];
      };
      expect(accountCall.data).toHaveLength(PCG_ACCOUNTS.length);
      expect(accountCall.data.every((a) => a.companyId === 'new-company-1')).toBe(true);
      // Spot-check one account's pcgClass is derived from its own leading digit, not hardcoded.
      const bankLine = accountCall.data.find((a) => a.number === '512000');
      expect(bankLine).toMatchObject({ label: 'Banques', pcgClass: 5 });

      const journalCall = prisma.tx.journal.createMany.mock.calls[0][0] as {
        data: { companyId: string; code: string }[];
      };
      expect(journalCall.data).toHaveLength(5);
      expect(journalCall.data.map((j) => j.code).sort()).toEqual(['AC', 'AN', 'BQ', 'OD', 'VE']);
      expect(journalCall.data.every((j) => j.companyId === 'new-company-1')).toBe(true);

      // No ownerUserId passed — no Membership row created.
      expect(prisma.tx.membership.create).not.toHaveBeenCalled();

      expect(result).toMatchObject({ id: 'new-company-1', name: 'Nouvelle société' });
    });

    it('creates an OWNER membership in the SAME transaction when an ownerUserId is given', async () => {
      await service.create(
        { name: 'Nouvelle société', jurisdiction: 'FR' },
        { ownerUserId: 'user-1' },
      );
      expect(prisma.tx.membership.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', companyId: 'new-company-1', role: 'OWNER' },
      });
    });

    it('jurisdiction does not change the scaffolded accounts or journals — same chart for FR and MC', async () => {
      await service.create({ name: 'Société MC', jurisdiction: 'MC' });
      const accountCall = prisma.tx.account.createMany.mock.calls[0][0] as { data: unknown[] };
      const journalCall = prisma.tx.journal.createMany.mock.calls[0][0] as { data: unknown[] };
      expect(accountCall.data).toHaveLength(PCG_ACCOUNTS.length);
      expect(journalCall.data).toHaveLength(JOURNALS.length);
    });
  });
});
