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
