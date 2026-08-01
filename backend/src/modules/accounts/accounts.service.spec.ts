import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Account, Prisma } from '@prisma/client';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function makePrismaMock() {
  const prisma = {
    account: {
      create: jest.fn((args: { data: object }) => ({ id: 'acc-1', ...args.data })),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn((args: { where: { id: string }; data: object }) => ({
        id: args.where.id,
        ...args.data,
      })),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

const collectif401: Account = {
  id: 'acc-401',
  companyId: 'company-1',
  number: '401000',
  label: 'Fournisseurs',
  pcgClass: 4,
  isAuxiliary: false,
  parentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AccountsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: AccountsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new AccountsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('derives the PCG class from the leading digit of the account number', async () => {
      const account = await service.create(company, { number: '411000', label: 'Clients' });
      expect(account).toMatchObject({ pcgClass: 4, number: '411000' });
    });

    it('scopes the created account to the current company', async () => {
      await service.create(company, { number: '607000', label: 'Achats de marchandises' });
      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ companyId: 'company-1' }) }),
      );
    });

    it('rejects an account number outside the PCG class range 1-8', async () => {
      await expect(service.create(company, { number: '9000', label: 'Bogus' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a non-numeric leading character', async () => {
      await expect(service.create(company, { number: 'X000', label: 'Bogus' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createTiers', () => {
    it('assigns "root+001" for the first tiers under a collectif', async () => {
      prisma.account.findFirst.mockResolvedValueOnce(collectif401);
      const tiers = await service.createTiers(company, 'acc-401', { label: 'Fournisseur Dupont' });
      expect(tiers).toMatchObject({
        number: '401001',
        label: 'Fournisseur Dupont',
        isAuxiliary: true,
        parentId: 'acc-401',
        pcgClass: 4,
      });
    });

    it('assigns the next sequential suffix after existing siblings', async () => {
      prisma.account.findFirst.mockResolvedValueOnce(collectif401);
      prisma.account.findMany.mockResolvedValueOnce([{ number: '401001' }, { number: '401002' }]);
      const tiers = await service.createTiers(company, 'acc-401', { label: 'Fournisseur Martin' });
      expect(tiers).toMatchObject({ number: '401003' });
    });

    it('rejects an unknown parent', async () => {
      prisma.account.findFirst.mockResolvedValueOnce(null);
      await expect(service.createTiers(company, 'nope', { label: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects creating a tiers under another tiers', async () => {
      prisma.account.findFirst.mockResolvedValueOnce({ ...collectif401, isAuxiliary: true });
      await expect(service.createTiers(company, 'acc-401', { label: 'X' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a parent collectif that is not 401 or 411', async () => {
      prisma.account.findFirst.mockResolvedValueOnce({
        ...collectif401,
        id: 'acc-607',
        number: '607000',
      });
      await expect(service.createTiers(company, 'acc-607', { label: 'X' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('translates a unique-constraint race into a clear ConflictException', async () => {
      prisma.account.findFirst.mockResolvedValueOnce(collectif401);
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.createTiers(company, 'acc-401', { label: 'X' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('listTiers', () => {
    it('lists only isAuxiliary children of the given parent', async () => {
      prisma.account.findFirst.mockResolvedValueOnce(collectif401);
      prisma.account.findMany.mockResolvedValueOnce([
        { id: 'tiers-1', number: '401001', label: 'Fournisseur Dupont', isAuxiliary: true },
      ]);
      const tiers = await service.listTiers(company, 'acc-401');
      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1', parentId: 'acc-401', isAuxiliary: true },
        }),
      );
      expect(tiers).toHaveLength(1);
    });

    it('rejects listing tiers under a non-collectif parent', async () => {
      prisma.account.findFirst.mockResolvedValueOnce({
        ...collectif401,
        id: 'acc-607',
        number: '607000',
      });
      await expect(service.listTiers(company, 'acc-607')).rejects.toThrow(BadRequestException);
    });
  });

  describe('rename', () => {
    it('updates only the label', async () => {
      prisma.account.findFirst.mockResolvedValueOnce(collectif401);
      const renamed = await service.rename(company, 'acc-401', { label: 'Fournisseurs (renommé)' });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-401' },
        data: { label: 'Fournisseurs (renommé)' },
      });
      expect(renamed).toMatchObject({ label: 'Fournisseurs (renommé)' });
    });

    it('rejects renaming an unknown account', async () => {
      prisma.account.findFirst.mockResolvedValueOnce(null);
      await expect(service.rename(company, 'nope', { label: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
