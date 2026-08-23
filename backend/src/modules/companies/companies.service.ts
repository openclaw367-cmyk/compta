import { Injectable, NotFoundException } from '@nestjs/common';
import { Company } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Not tenant-scoped: creating a Company is how a tenant comes into existence. */
  create(dto: CreateCompanyDto): Promise<Company> {
    return this.prisma.company.create({ data: dto });
  }

  /**
   * Not tenant-scoped, same reason as `create()` — this is the list a
   * company PICKER chooses from, so it must be reachable before any one
   * company is selected. See CLAUDE.md "Multi-tenant data model": the
   * frontend previously never sent `x-company-id` at all (single-company
   * UX); this is the first read that lets it discover what to send.
   */
  findAll(): Promise<Company[]> {
    return this.prisma.company.findMany({ orderBy: { createdAt: 'asc' } });
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
