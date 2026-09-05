import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Membership, MembershipRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { AuthenticatedUser } from '../../common/auth/request-with-user';
import { generateOpaqueToken } from '../../common/auth/opaque-token';
import { MAILER_PORT, MailerPort } from '../mailer/mailer.port';
import { ActivityService } from '../activity/activity.service';
import { InviteMemberDto } from './dto/invite-member.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Member/invite management for the CURRENT company — see CLAUDE.md
 * "Multi-user / roles & permissions". Company-scoped for free via the
 * existing CompanyContextMiddleware (CompanyContext already carries the
 * caller's own resolved role). ReadOnlyGuard (registered globally)
 * already blocks a READ_ONLY member from reaching any mutating method
 * here; the finer OWNER-vs-MEMBER check below is this service's own
 * concern, since ReadOnlyGuard only knows about READ_ONLY.
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER_PORT) private readonly mailer: MailerPort,
    private readonly activity: ActivityService,
  ) {}

  async list(company: CompanyContext) {
    const [members, pendingInvites] = await Promise.all([
      this.prisma.membership.findMany({
        where: { companyId: company.companyId },
        include: { user: { select: { id: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.companyInvite.findMany({
        where: { companyId: company.companyId, acceptedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      members: members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        email: m.user.email,
        role: m.role,
      })),
      pendingInvites,
    };
  }

  async invite(
    company: CompanyContext,
    caller: AuthenticatedUser,
    dto: InviteMemberDto,
  ): Promise<void> {
    this.assertOwner(company);
    const email = dto.email.toLowerCase();

    const existingMember = await this.prisma.membership.findFirst({
      where: { companyId: company.companyId, user: { email } },
    });
    if (existingMember) {
      throw new ConflictException('This email is already a member of this company.');
    }

    const { raw, hash } = generateOpaqueToken();
    const companyRow = await this.prisma.company.findUniqueOrThrow({
      where: { id: company.companyId },
      select: { name: true },
    });
    await this.prisma.companyInvite.create({
      data: {
        companyId: company.companyId,
        email,
        role: dto.role,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedByUserId: caller.id,
      },
    });
    const inviteUrl = `${this.frontendOrigin()}/invitation?token=${raw}`;
    await this.mailer.sendCompanyInviteEmail(email, companyRow.name, inviteUrl, caller.email);
    await this.activity.log(company, 'MEMBER_INVITED', caller.email, { targetEmail: email });
  }

  async revokeInvite(company: CompanyContext, inviteId: string): Promise<void> {
    this.assertOwner(company);
    const invite = await this.prisma.companyInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.companyId !== company.companyId) {
      throw new NotFoundException('Invite not found.');
    }
    await this.prisma.companyInvite.delete({ where: { id: inviteId } });
  }

  async updateRole(
    company: CompanyContext,
    caller: AuthenticatedUser,
    membershipId: string,
    role: MembershipRole,
  ): Promise<Membership> {
    this.assertOwner(company);
    const membership = await this.findMembershipOrThrow(company, membershipId);
    if (membership.role === 'OWNER' && role !== 'OWNER') {
      await this.assertNotLastOwner(company, membershipId);
    }
    const updated = await this.prisma.membership.update({
      where: { id: membershipId },
      data: { role },
    });
    await this.activity.log(company, 'MEMBER_ROLE_CHANGED', caller.email, {
      targetEmail: membership.user.email,
      detail: `${membership.role} → ${role}`,
    });
    return updated;
  }

  async remove(
    company: CompanyContext,
    caller: AuthenticatedUser,
    membershipId: string,
  ): Promise<void> {
    this.assertOwner(company);
    const membership = await this.findMembershipOrThrow(company, membershipId);
    if (membership.role === 'OWNER') {
      await this.assertNotLastOwner(company, membershipId);
    }
    await this.prisma.membership.delete({ where: { id: membershipId } });
    await this.activity.log(company, 'MEMBER_REMOVED', caller.email, {
      targetEmail: membership.user.email,
    });
  }

  private assertOwner(company: CompanyContext): void {
    if (company.role !== 'OWNER') {
      throw new ForbiddenException('Only an owner can manage members of this company.');
    }
  }

  private async findMembershipOrThrow(
    company: CompanyContext,
    membershipId: string,
  ): Promise<Membership & { user: { email: string } }> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: { user: { select: { email: true } } },
    });
    if (!membership || membership.companyId !== company.companyId) {
      throw new NotFoundException('Membership not found.');
    }
    return membership;
  }

  /** A company must always keep at least one OWNER. */
  private async assertNotLastOwner(company: CompanyContext, excludingId: string): Promise<void> {
    const remainingOwners = await this.prisma.membership.count({
      where: { companyId: company.companyId, role: 'OWNER', id: { not: excludingId } },
    });
    if (remainingOwners === 0) {
      throw new BadRequestException('A company must always have at least one owner.');
    }
  }

  private frontendOrigin(): string {
    return process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  }
}
