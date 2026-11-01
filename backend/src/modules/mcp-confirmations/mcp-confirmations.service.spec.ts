import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { McpConfirmationsService } from './mcp-confirmations.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntriesService } from '../entries/entries.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { ProposedEcriture } from '../ai-chat/tools/propose-tools.service';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };
const USER_ID = 'user-1';

function makeProposal(): ProposedEcriture {
  return {
    dto: {
      journalId: 'journal-1',
      fiscalYearId: 'fy-1',
      ecritureDate: '2026-11-01',
      libelle: 'test',
      lignes: [
        { compteId: 'account-607', debit: '42.00' },
        { compteId: 'account-512', credit: '42.00' },
      ],
    },
    warnings: [],
    assumptions: [],
  };
}

function makePendingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-1',
    tokenHash: 'hash',
    userId: USER_ID,
    companyId: company.companyId,
    dto: makeProposal().dto,
    warnings: [],
    assumptions: [],
    status: 'PENDING',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    resolvedAt: null,
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    mcpProposalToken: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

function makeEntriesMock() {
  return { create: jest.fn().mockResolvedValue({ id: 'ecriture-1', validatedAt: null }) };
}

function makeConfigMock(frontendOrigin?: string) {
  return { get: jest.fn().mockReturnValue(frontendOrigin) };
}

describe('McpConfirmationsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let entries: ReturnType<typeof makeEntriesMock>;
  let config: ReturnType<typeof makeConfigMock>;
  let service: McpConfirmationsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    entries = makeEntriesMock();
    config = makeConfigMock();
    service = new McpConfirmationsService(
      prisma as unknown as PrismaService,
      entries as unknown as EntriesService,
      config as never,
    );
  });

  describe('createToken', () => {
    it('persists a row scoped to (userId, companyId) and returns a URL built from FRONTEND_ORIGIN', async () => {
      config.get.mockReturnValue('https://app.example.com');
      const url = await service.createToken(USER_ID, company, makeProposal());
      expect(prisma.mcpProposalToken.create).toHaveBeenCalledTimes(1);
      const args = prisma.mcpProposalToken.create.mock.calls[0][0];
      expect(args.data.userId).toBe(USER_ID);
      expect(args.data.companyId).toBe(company.companyId);
      expect(args.data.status).toBeUndefined(); // defaults to PENDING at the schema level
      expect(url.startsWith('https://app.example.com/mcp-confirm/')).toBe(true);
    });

    it('defaults to http://localhost:5173 when FRONTEND_ORIGIN is unset', async () => {
      config.get.mockReturnValue(undefined);
      const url = await service.createToken(USER_ID, company, makeProposal());
      expect(url.startsWith('http://localhost:5173/mcp-confirm/')).toBe(true);
    });

    it('never stores the raw token — only a hash', async () => {
      await service.createToken(USER_ID, company, makeProposal());
      const args = prisma.mcpProposalToken.create.mock.calls[0][0];
      expect(args.data.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    });
  });

  describe('listPending', () => {
    it('scopes to (userId, companyId, PENDING, not expired)', async () => {
      await service.listPending(USER_ID, company);
      expect(prisma.mcpProposalToken.findMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          companyId: company.companyId,
          status: 'PENDING',
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('returns every pending row, not just one — the batch IS the full list', async () => {
      prisma.mcpProposalToken.findMany.mockResolvedValue([
        makePendingRow({ id: 'row-1' }),
        makePendingRow({ id: 'row-2' }),
        makePendingRow({ id: 'row-3' }),
      ]);
      const result = await service.listPending(USER_ID, company);
      expect(result.map((r) => r.id)).toEqual(['row-1', 'row-2', 'row-3']);
    });
  });

  describe('confirm', () => {
    it('flips status atomically BEFORE calling EntriesService.create()', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(makePendingRow());
      prisma.mcpProposalToken.updateMany.mockResolvedValue({ count: 1 });
      await service.confirm('row-1', USER_ID, company);
      expect(prisma.mcpProposalToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1', status: 'PENDING' },
        data: { status: 'CONFIRMED', resolvedAt: expect.any(Date) },
      });
      const updateOrder = prisma.mcpProposalToken.updateMany.mock.invocationCallOrder[0];
      const createOrder = entries.create.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(createOrder);
      expect(entries.create).toHaveBeenCalledWith(company, makeProposal().dto);
    });

    it('is single-use: a second confirm attempt is refused via ConflictException, create() not called again', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(makePendingRow());
      prisma.mcpProposalToken.updateMany.mockResolvedValue({ count: 0 }); // already flipped
      await expect(service.confirm('row-1', USER_ID, company)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(entries.create).not.toHaveBeenCalled();
    });

    it('refuses a row belonging to a different user — NotFoundException, never ForbiddenException (no existence leak)', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(
        makePendingRow({ userId: 'someone-else' }),
      );
      await expect(service.confirm('row-1', USER_ID, company)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.mcpProposalToken.updateMany).not.toHaveBeenCalled();
      expect(entries.create).not.toHaveBeenCalled();
    });

    it('refuses a row belonging to a different company', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(
        makePendingRow({ companyId: 'someone-elses-company' }),
      );
      await expect(service.confirm('row-1', USER_ID, company)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(entries.create).not.toHaveBeenCalled();
    });

    it('refuses an unknown row id', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(null);
      await expect(service.confirm('row-x', USER_ID, company)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses an expired row, even if owned correctly, without touching status', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(
        makePendingRow({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.confirm('row-1', USER_ID, company)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.mcpProposalToken.updateMany).not.toHaveBeenCalled();
      expect(entries.create).not.toHaveBeenCalled();
    });

    it('resolves CompanyContext fresh at confirm time — uses the CALLER-supplied company, not anything cached on the row', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(makePendingRow());
      prisma.mcpProposalToken.updateMany.mockResolvedValue({ count: 1 });
      const readOnlyAtConfirmTime: CompanyContext = { companyId: 'company-1', role: 'READ_ONLY' };
      await service.confirm('row-1', USER_ID, readOnlyAtConfirmTime);
      expect(entries.create).toHaveBeenCalledWith(readOnlyAtConfirmTime, makeProposal().dto);
    });
  });

  describe('reject', () => {
    it('flips status to REJECTED and never calls EntriesService.create()', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(makePendingRow());
      prisma.mcpProposalToken.updateMany.mockResolvedValue({ count: 1 });
      await service.reject('row-1', USER_ID, company);
      expect(prisma.mcpProposalToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1', status: 'PENDING' },
        data: { status: 'REJECTED', resolvedAt: expect.any(Date) },
      });
      expect(entries.create).not.toHaveBeenCalled();
    });

    it('is single-use, same as confirm', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(makePendingRow());
      prisma.mcpProposalToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reject('row-1', USER_ID, company)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejecting one row never touches any other pending row', async () => {
      prisma.mcpProposalToken.findUnique.mockResolvedValue(makePendingRow({ id: 'row-2' }));
      prisma.mcpProposalToken.updateMany.mockResolvedValue({ count: 1 });
      await service.reject('row-2', USER_ID, company);
      expect(prisma.mcpProposalToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-2', status: 'PENDING' },
        data: { status: 'REJECTED', resolvedAt: expect.any(Date) },
      });
    });
  });
});
