import * as bcrypt from 'bcrypt';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessTokenService } from '../../common/auth/access-token.service';
import { hashOpaqueToken } from '../../common/auth/opaque-token';
import { CompaniesService } from '../companies/companies.service';
import { ActivityService } from '../activity/activity.service';

function makePrismaMock() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordResetToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    companyInvite: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    membership: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

function makeService(prisma: ReturnType<typeof makePrismaMock>) {
  const companiesService = { create: jest.fn().mockResolvedValue({ id: 'company-1' }) };
  const accessTokens = { sign: jest.fn().mockReturnValue('signed-access-token') };
  const mailer = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendCompanyInviteEmail: jest.fn().mockResolvedValue(undefined),
  };
  const activity = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    companiesService as unknown as CompaniesService,
    accessTokens as unknown as AccessTokenService,
    mailer,
    activity as unknown as ActivityService,
  );
  return { service, prisma, companiesService, accessTokens, mailer, activity };
}

describe('AuthService', () => {
  describe('signup', () => {
    it('creates the user, then the company with the new user as OWNER, and issues tokens', async () => {
      const { service, prisma, companiesService, accessTokens } = makeService(makePrismaMock());
      prisma.user.create.mockResolvedValue({ id: 'user-1', email: 'jane@example.com' });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.signup({
        email: 'Jane@Example.com',
        password: 'a-strong-password',
        companyName: 'Ma Société',
      });

      // Email is lowercased before every read/write.
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'jane@example.com' }) }),
      );
      expect(companiesService.create).toHaveBeenCalledWith(
        { name: 'Ma Société', jurisdiction: 'FR' },
        { ownerUserId: 'user-1' },
      );
      expect(accessTokens.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'jane@example.com',
      });
      expect(result.accessToken).toBe('signed-access-token');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.user).toEqual({ id: 'user-1', email: 'jane@example.com' });
    });

    it('rejects signup for an email that already has an account', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.signup({ email: 'jane@example.com', password: 'x', companyName: 'X' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('issues tokens for a correct password', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'jane@example.com',
        passwordHash,
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login({
        email: 'jane@example.com',
        password: 'correct-password',
      });
      expect(result.accessToken).toBe('signed-access-token');
    });

    it('rejects an incorrect password', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'jane@example.com',
        passwordHash,
      });

      await expect(
        service.login({ email: 'jane@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown email without revealing whether the account exists', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('rotates: issues a new token and revokes the old one, chained via replacedById', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: { id: 'user-1', email: 'jane@example.com' },
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });

      const result = await service.refresh('raw-token');

      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', familyId: 'family-1' }),
        }),
      );
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date), replacedById: 'rt-2' },
      });
      expect(result.user).toEqual({ id: 'user-1', email: 'jane@example.com' });
    });

    it('rejects an unknown token', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('bogus')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        familyId: 'family-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: { id: 'user-1', email: 'jane@example.com' },
      });
      await expect(service.refresh('raw-token')).rejects.toThrow(UnauthorizedException);
    });

    it('reuse-detection: presenting an already-revoked token revokes the WHOLE family, not just that row', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        familyId: 'family-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: { id: 'user-1', email: 'jane@example.com' },
      });

      await expect(service.refresh('stolen-token')).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('logout', () => {
    it('revokes the presented token', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      await service.logout('raw-token');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: hashOpaqueToken('raw-token'), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('is a no-op, not an error, when no token is presented', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('creates a reset token and emails it when the account exists', async () => {
      const { service, prisma, mailer } = makeService(makePrismaMock());
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'jane@example.com' });
      prisma.passwordResetToken.create.mockResolvedValue({});

      await service.forgotPassword('jane@example.com');

      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      expect(mailer.sendPasswordResetEmail).toHaveBeenCalledWith(
        'jane@example.com',
        expect.stringContaining('/reinitialiser-mot-de-passe?token='),
      );
    });

    it('silently does nothing for an unknown email — never reveals account existence', async () => {
      const { service, prisma, mailer } = makeService(makePrismaMock());
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
      expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates the password and revokes every other refresh token for the account', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await service.resetPassword('raw-token', 'a-new-password');

      expect(prisma.$transaction).toHaveBeenCalled();
      const ops = (prisma.$transaction as jest.Mock).mock.calls[0][0] as unknown[];
      expect(ops).toHaveLength(3);
    });

    it('rejects an already-used or expired token', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      await expect(service.resetPassword('raw-token', 'x')).rejects.toThrow(BadRequestException);
    });
  });

  describe('acceptInvite', () => {
    it('creates a brand-new user + membership when the invited email has no account yet', async () => {
      const { service, prisma, activity } = makeService(makePrismaMock());
      prisma.companyInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        companyId: 'company-1',
        email: 'new@example.com',
        role: 'MEMBER',
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-new', email: 'new@example.com' });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.acceptInvite({ token: 'raw', password: 'a-new-password' });

      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.user.email).toBe('new@example.com');
      expect(activity.log).toHaveBeenCalledWith(
        { companyId: 'company-1', role: 'MEMBER' },
        'MEMBER_INVITE_ACCEPTED',
        'new@example.com',
      );
    });

    it('rejects when creating a new account and no password is supplied', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.companyInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        companyId: 'company-1',
        email: 'new@example.com',
        role: 'MEMBER',
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.acceptInvite({ token: 'raw' })).rejects.toThrow(BadRequestException);
    });

    it('just adds a membership when the invited email already has an account', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.companyInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        companyId: 'company-1',
        email: 'existing@example.com',
        role: 'READ_ONLY',
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-existing',
        email: 'existing@example.com',
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.acceptInvite({ token: 'raw' });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.user.email).toBe('existing@example.com');
    });

    it('rejects an expired or already-accepted invite', async () => {
      const { service, prisma } = makeService(makePrismaMock());
      prisma.companyInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      await expect(service.acceptInvite({ token: 'raw' })).rejects.toThrow(BadRequestException);
    });
  });
});
