import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FiscalYear, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

@Injectable()
export class FiscalYearsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(company: CompanyContext, dto: CreateFiscalYearDto): Promise<FiscalYear> {
    try {
      return await this.prisma.fiscalYear.create({
        data: {
          companyId: company.companyId,
          label: dto.label,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR) {
          throw new ConflictException(`Fiscal year "${dto.label}" already exists.`);
        }
      }
      throw error;
    }
  }

  findAll(company: CompanyContext): Promise<FiscalYear[]> {
    return this.prisma.fiscalYear.findMany({
      where: { companyId: company.companyId },
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(company: CompanyContext, id: string): Promise<FiscalYear> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${id} not found`);
    }
    return fiscalYear;
  }

  /** Locks the fiscal year. Does not itself validate open écritures — see EntriesService. */
  async close(company: CompanyContext, id: string): Promise<FiscalYear> {
    const fiscalYear = await this.findOne(company, id);
    if (fiscalYear.closedAt) {
      throw new ConflictException(`Fiscal year "${fiscalYear.label}" is already closed.`);
    }
    return this.prisma.fiscalYear.update({
      where: { id: fiscalYear.id },
      data: { closedAt: new Date() },
    });
  }
}
