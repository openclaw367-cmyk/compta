import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessTokenService } from '../../common/auth/access-token.service';
import { generateOpaqueToken, hashOpaqueToken } from '../../common/auth/opaque-token';
import { CompaniesService } from '../companies/companies.service';
import { MAILER_PORT, MailerPort } from '../mailer/mailer.port';
import { ActivityService } from '../activity/activity.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';

const BCRYPT_COST = 12;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, flat — no "remember me" toggle this phase.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour.

// Compared against on a login attempt for an email that doesn't exist, so
// the request takes roughly the same time either way — a cheap timing-attack
// mitigation, not a claim of full constant-time guarantees.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

/**
 * Signup/login/refresh/logout/password-reset — see CLAUDE.md
 * "Multi-user / roles & permissions". HTTP-agnostic on purpose: cookie
 * handling (the refresh token) lives entirely in AuthController, so this
 * service is plainly unit-testable and never touches Response/Request.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companiesService: CompaniesService,
    private readonly accessTokens: AccessTokenService,
    @Inject(MAILER_PORT) private readonly mailer: MailerPort,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Creates the User, then the Company (+ scaffolded accounts/journals +
   * an OWNER Membership, all in CompaniesService.create()'s own single
   * transaction) — two calls, not one shared transaction spanning both.
   * ACCEPTED, DOCUMENTED gap: a failure between them would leave a User
   * with no company, extremely unlikely (an infra failure, not a
   * business-logic branch) and recoverable by signing up again with a
   * different email or by an operator granting a Membership by hand —
   * same "accepted risk, matching existing precedent" class as
   * disposeFixedAsset()'s own two-step cessionEcritureId assignment
   * (see CLAUDE.md "Invoicing — Phase A"), not a new kind of gap
   * introduced here.
   */
  async signup(dto: SignupDto): Promise<IssuedTokens> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.prisma.user.create({ data: { email, passwordHash } });
    await this.companiesService.create(
      { name: dto.companyName, jurisdiction: 'FR' },
      { ownerUserId: user.id },
    );
    return this.issueTokenPair(user);
  }

  async login(dto: LoginDto): Promise<IssuedTokens> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always run bcrypt.compare, even for an unknown email (against a fixed
    // dummy hash), so a login attempt's timing doesn't reveal whether the
    // address has an account.
    const passwordMatches = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return this.issueTokenPair(user);
  }

  /**
   * Rotation with reuse-detection: a valid, unexpired, unrevoked token is
   * exchanged for a new one (old row marked revokedAt, chained via
   * replacedById). Presenting an ALREADY-revoked token is treated as a
   * stolen/replayed-token signal and revokes the entire rotation family,
   * not just the one row — see RefreshToken's own doc comment in
   * schema.prisma.
   */
  async refresh(rawToken: string): Promise<IssuedTokens> {
    const tokenHash = hashOpaqueToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'This refresh token was already used. All sessions for this account have been revoked ' +
          'as a precaution — please log in again.',
      );
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired.');
    }

    const { raw, hash } = generateOpaqueToken();
    const newToken = await this.prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hash,
        familyId: stored.familyId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: newToken.id },
    });

    return {
      accessToken: this.accessTokens.sign({ sub: stored.user.id, email: stored.user.email }),
      refreshToken: raw,
      user: { id: stored.user.id, email: stored.user.email },
    };
  }

  /** Idempotent: revoking an already-invalid/missing token is not an error. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashOpaqueToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Never reveals whether the email has an account — the controller
   * always returns the same generic success response regardless of
   * what this resolves to.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return;
    const { raw, hash } = generateOpaqueToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });
    const resetUrl = `${this.frontendOrigin()}/reinitialiser-mot-de-passe?token=${raw}`;
    await this.mailer.sendPasswordResetEmail(user.email, resetUrl);
  }

  /**
   * On success, also revokes every existing refresh token for this user
   * (forces re-login on every other session) — a real security nicety a
   * password reset should always carry, not an afterthought.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashOpaqueToken(rawToken);
    const stored = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new BadRequestException('This password reset link is invalid or has expired.');
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /**
   * Accepting an invite either creates a brand-new User + Membership
   * (the invited email has no account yet — `dto.password` is required),
   * or, if that email already has an account, just adds the Membership.
   * Either way, the caller is auto-logged-in on success (issued tokens
   * directly) — no separate "now go log in" step, matching the
   * frictionless-onboarding mandate. Deliberately does NOT require the
   * existing-account case to re-prove their password: possessing this
   * exact one-time emailed token for their own address is treated as
   * sufficient proof for this first pass — a stricter future pass could
   * require it, not built this phase.
   */
  async acceptInvite(dto: AcceptInviteDto): Promise<IssuedTokens> {
    const tokenHash = hashOpaqueToken(dto.token);
    const invite = await this.prisma.companyInvite.findUnique({ where: { tokenHash } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new BadRequestException('This invitation is invalid or has expired.');
    }

    let user = await this.prisma.user.findUnique({ where: { email: invite.email } });
    if (!user) {
      if (!dto.password) {
        throw new BadRequestException('A password is required to create your account.');
      }
      const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
      user = await this.prisma.user.create({ data: { email: invite.email, passwordHash } });
    }

    await this.prisma.$transaction([
      this.prisma.membership.upsert({
        where: { userId_companyId: { userId: user.id, companyId: invite.companyId } },
        update: { role: invite.role },
        create: { userId: user.id, companyId: invite.companyId, role: invite.role },
      }),
      this.prisma.companyInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    await this.activity.log(
      { companyId: invite.companyId, role: invite.role },
      'MEMBER_INVITE_ACCEPTED',
      user.email,
    );

    return this.issueTokenPair(user);
  }

  private async issueTokenPair(user: User): Promise<IssuedTokens> {
    const { raw, hash } = generateOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return {
      accessToken: this.accessTokens.sign({ sub: user.id, email: user.email }),
      refreshToken: raw,
      user: { id: user.id, email: user.email },
    };
  }

  private frontendOrigin(): string {
    return process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  }
}
