import { Injectable, NotFoundException } from '@nestjs/common';
import { Company, MembershipRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { PCG_ACCOUNTS, JOURNALS } from '../../common/pcg/pcg-accounts';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Not tenant-scoped: creating a Company is how a tenant comes into
   * existence. Also scaffolds the same standard chart of accounts and
   * the five standard journals `prisma/seed.ts`/`seed-monaco.ts` give the
   * demo companies — sourced from the exact same PCG_ACCOUNTS/JOURNALS
   * module, not a parallel copy — so a company created through the app
   * is immediately usable rather than landing with nothing to post
   * against. Jurisdiction doesn't change this scaffolding at all (see
   * that module's own doc comment); it only selects the VAT declaration
   * computation later, at declaration time. Deliberately does NOT seed
   * any VatRate — neither seed script does either; the user adds their
   * own via the existing "+ Nouveau taux" screen. One transaction, so a
   * failure partway through never leaves a company with accounts but no
   * journals (or vice versa).
   *
   * `options.ownerUserId` (new, see CLAUDE.md "Multi-user / roles &
   * permissions") — when provided, creates an OWNER Membership for that
   * user in the SAME transaction, so a company is never left without an
   * owner if the request fails partway. Used by both AuthService.signup()
   * (a brand-new user's first company) and CompaniesController.create()
   * (an existing, authenticated user adding another company).
   */
  create(dto: CreateCompanyDto, options?: { ownerUserId?: string }): Promise<Company> {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: dto });
      await tx.account.createMany({
        data: PCG_ACCOUNTS.map((account) => ({
          companyId: company.id,
          number: account.number,
          label: account.label,
          pcgClass: Number(account.number.charAt(0)),
        })),
      });
      await tx.journal.createMany({
        data: JOURNALS.map((journal) => ({
          companyId: company.id,
          code: journal.code,
          label: journal.label,
          type: journal.type,
        })),
      });
      if (options?.ownerUserId) {
        await tx.membership.create({
          data: { userId: options.ownerUserId, companyId: company.id, role: 'OWNER' },
        });
      }
      return company;
    });
  }

  /**
   * Membership-scoped, not global — see CLAUDE.md "Multi-user / roles &
   * permissions". Before auth existed this returned EVERY company in the
   * database (the list a company picker chooses from, reachable before
   * any one company is selected — that reasoning is unchanged); now it's
   * "every company THIS caller belongs to," resolved via their own
   * Membership rows. Each result carries the caller's own `role` for
   * that company inline, so the frontend never needs a second round-trip
   * to know whether e.g. the "Membres" admin screen should be reachable.
   */
  async findAllForUser(userId: string): Promise<(Company & { role: MembershipRole })[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { company: true },
      orderBy: { company: { createdAt: 'asc' } },
    });
    return memberships.map(({ company, role }) => ({ ...company, role }));
  }

  async findCurrent(company: CompanyContext): Promise<Company> {
    const found = await this.prisma.company.findUnique({ where: { id: company.companyId } });
    if (!found) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
    }
    return found;
  }

  async updateCurrent(company: CompanyContext, dto: UpdateCompanyDto): Promise<Company> {
    await this.findCurrent(company);
    return this.prisma.company.update({ where: { id: company.companyId }, data: dto });
  }
}
