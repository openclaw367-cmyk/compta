import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { MailerPort } from '../mailer/mailer.port';
import { ActivityService } from '../activity/activity.service';

const owner: CompanyContext = { companyId: 'company-1', role: 'OWNER' };
const member: CompanyContext = { companyId: 'company-1', role: 'MEMBER' };
const caller = { id: 'user-owner', email: 'owner@example.com' };

function makePrismaMock() {
  return {
    membership: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
    companyInvite: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    company: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Ma Société' }),
    },
  };
}

function makeService(prisma: ReturnType<typeof makePrismaMock>) {
  const mailer = { sendCompanyInviteEmail: jest.fn().mockResolvedValue(undefined) };
  const activity = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new MembershipsService(
    prisma as unknown as PrismaService,
    mailer as unknown as MailerPort,
    activity as unknown as ActivityService,
  );
  return { service, mailer, activity };
}

describe('MembershipsService', () => {
  describe('invite', () => {
    it('an OWNER can invite a new email, creating the invite and emailing it', async () => {
      const prisma = makePrismaMock();
      const { service, mailer, activity } = makeService(prisma);

      await service.invite(owner, caller, { email: 'New@Example.com', role: 'MEMBER' });

      expect(prisma.companyInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'company-1',
            email: 'new@example.com',
            role: 'MEMBER',
            invitedByUserId: 'user-owner',
          }),
        }),
      );
      expect(mailer.sendCompanyInviteEmail).toHaveBeenCalledWith(
        'new@example.com',
        'Ma Société',
        expect.stringContaining('/invitation?token='),
        'owner@example.com',
      );
      expect(activity.log).toHaveBeenCalledWith(owner, 'MEMBER_INVITED', caller.email, {
        targetEmail: 'new@example.com',
      });
    });

    it('a non-owner (MEMBER) cannot invite — this service enforces its own OWNER-only check', async () => {
      const { service } = makeService(makePrismaMock());
      await expect(
        service.invite(member, caller, { email: 'new@example.com', role: 'MEMBER' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects inviting an email that is already a member', async () => {
      const prisma = makePrismaMock();
      prisma.membership.findFirst.mockResolvedValue({ id: 'membership-existing' });
      const { service } = makeService(prisma);

      await expect(
        service.invite(owner, caller, { email: 'existing@example.com', role: 'MEMBER' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateRole', () => {
    it('an owner can change a member role', async () => {
      const prisma = makePrismaMock();
      prisma.membership.findUnique.mockResolvedValue({
        id: 'membership-2',
        companyId: 'company-1',
        role: 'MEMBER',
        user: { email: 'member@example.com' },
      });
      const { service, activity } = makeService(prisma);

      await service.updateRole(owner, caller, 'membership-2', 'READ_ONLY');
      expect(prisma.membership.update).toHaveBeenCalledWith({
        where: { id: 'membership-2' },
        data: { role: 'READ_ONLY' },
      });
      expect(activity.log).toHaveBeenCalledWith(owner, 'MEMBER_ROLE_CHANGED', caller.email, {
        targetEmail: 'member@example.com',
        detail: 'MEMBER → READ_ONLY',
      });
    });

    it('refuses to demote the LAST remaining owner', async () => {
      const prisma = makePrismaMock();
      prisma.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        companyId: 'company-1',
        role: 'OWNER',
        user: { email: 'owner2@example.com' },
      });
      prisma.membership.count.mockResolvedValue(0); // no other owners
      const { service } = makeService(prisma);

      await expect(service.updateRole(owner, caller, 'membership-1', 'MEMBER')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });

    it('allows demoting an owner when another owner remains', async () => {
      const prisma = makePrismaMock();
      prisma.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        companyId: 'company-1',
        role: 'OWNER',
        user: { email: 'owner2@example.com' },
      });
      prisma.membership.count.mockResolvedValue(1); // one other owner exists
      const { service } = makeService(prisma);

      await service.updateRole(owner, caller, 'membership-1', 'MEMBER');
      expect(prisma.membership.update).toHaveBeenCalled();
    });

    it('rejects a membership that belongs to a different company', async () => {
      const prisma = makePrismaMock();
      prisma.membership.findUnique.mockResolvedValue({
        id: 'membership-x',
        companyId: 'some-other-company',
        role: 'MEMBER',
        user: { email: 'other@example.com' },
      });
      const { service } = makeService(prisma);

      await expect(service.updateRole(owner, caller, 'membership-x', 'READ_ONLY')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('an owner can remove a member', async () => {
      const prisma = makePrismaMock();
      prisma.membership.findUnique.mockResolvedValue({
        id: 'membership-2',
        companyId: 'company-1',
        role: 'MEMBER',
        user: { email: 'member@example.com' },
      });
      const { service, activity } = makeService(prisma);

      await service.remove(owner, caller, 'membership-2');
      expect(prisma.membership.delete).toHaveBeenCalledWith({ where: { id: 'membership-2' } });
      expect(activity.log).toHaveBeenCalledWith(owner, 'MEMBER_REMOVED', caller.email, {
        targetEmail: 'member@example.com',
      });
    });

    it('refuses to remove the LAST remaining owner', async () => {
      const prisma = makePrismaMock();
      prisma.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        companyId: 'company-1',
        role: 'OWNER',
        user: { email: 'owner2@example.com' },
      });
      prisma.membership.count.mockResolvedValue(0);
      const { service } = makeService(prisma);

      await expect(service.remove(owner, caller, 'membership-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.membership.delete).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns members and pending invites for the current company', async () => {
      const prisma = makePrismaMock();
      prisma.membership.findMany.mockResolvedValue([
        {
          id: 'membership-1',
          role: 'OWNER',
          user: { id: 'user-owner', email: 'owner@example.com' },
        },
      ]);
      prisma.companyInvite.findMany.mockResolvedValue([
        {
          id: 'invite-1',
          email: 'pending@example.com',
          role: 'MEMBER',
          expiresAt: new Date(),
          createdAt: new Date(),
        },
      ]);
      const { service } = makeService(prisma);

      const result = await service.list(owner);
      expect(result.members).toEqual([
        { id: 'membership-1', userId: 'user-owner', email: 'owner@example.com', role: 'OWNER' },
      ]);
      expect(result.pendingInvites).toHaveLength(1);
    });
  });
});
