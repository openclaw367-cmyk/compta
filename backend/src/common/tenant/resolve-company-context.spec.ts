import { ForbiddenException } from '@nestjs/common';
import { resolveCompanyContextForUser } from './resolve-company-context';
import { PrismaService } from '../prisma/prisma.service';

function makePrismaMock() {
  return { membership: { findUnique: jest.fn() } };
}

describe('resolveCompanyContextForUser', () => {
  it('returns {companyId, role} when the user is a member of the company', async () => {
    const prisma = makePrismaMock();
    prisma.membership.findUnique.mockResolvedValue({ role: 'OWNER' });
    const result = await resolveCompanyContextForUser(
      prisma as unknown as PrismaService,
      'user-1',
      'company-1',
    );
    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'user-1', companyId: 'company-1' } },
      select: { role: true },
    });
    expect(result).toEqual({ companyId: 'company-1', role: 'OWNER' });
  });

  it('throws ForbiddenException when no membership exists', async () => {
    const prisma = makePrismaMock();
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(
      resolveCompanyContextForUser(prisma as unknown as PrismaService, 'user-1', 'someone-elses'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
