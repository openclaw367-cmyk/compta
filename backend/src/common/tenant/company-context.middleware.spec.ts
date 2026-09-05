import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CompanyContextMiddleware } from './company-context.middleware';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWithCompany } from './request-with-company';

function makeReq(companyIdHeader: string | undefined): RequestWithCompany {
  return {
    header: jest.fn().mockReturnValue(companyIdHeader),
    user: { id: 'user-1', email: 'jane@example.com' },
  } as unknown as RequestWithCompany;
}

function makePrismaMock() {
  return { membership: { findUnique: jest.fn() } };
}

describe('CompanyContextMiddleware', () => {
  it('attaches {companyId, role} when the caller is a member of the requested company', async () => {
    const prisma = makePrismaMock();
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const middleware = new CompanyContextMiddleware(prisma as unknown as PrismaService);
    const req = makeReq('company-1');
    const next = jest.fn();

    await middleware.use(req, {} as never, next);

    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'user-1', companyId: 'company-1' } },
      select: { role: true },
    });
    expect(req.companyContext).toEqual({ companyId: 'company-1', role: 'MEMBER' });
    expect(next).toHaveBeenCalled();
  });

  it('rejects when the x-company-id header is missing — no more "guess the single company" fallback', async () => {
    const prisma = makePrismaMock();
    const middleware = new CompanyContextMiddleware(prisma as unknown as PrismaService);
    await expect(middleware.use(makeReq(undefined), {} as never, jest.fn())).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when the caller has no membership for the requested company', async () => {
    const prisma = makePrismaMock();
    prisma.membership.findUnique.mockResolvedValue(null);
    const middleware = new CompanyContextMiddleware(prisma as unknown as PrismaService);
    await expect(
      middleware.use(makeReq('someone-elses-company'), {} as never, jest.fn()),
    ).rejects.toThrow(ForbiddenException);
  });
});
