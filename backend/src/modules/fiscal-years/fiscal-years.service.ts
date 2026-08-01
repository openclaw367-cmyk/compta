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

  /**
   * Locks the fiscal year. Refuses while any écriture in it is still a
   * draft (unvalidated) — once closed, EntriesService/ImportExcelService
   * reject new or mutated écritures for it (see assertFiscalYearOpen), so
   * a draft left behind at close time would become permanently stuck.
   */
  async close(company: CompanyContext, id: string): Promise<FiscalYear> {
    const fiscalYear = await this.findOne(company, id);
    if (fiscalYear.closedAt) {
      throw new ConflictException(`Fiscal year "${fiscalYear.label}" is already closed.`);
    }

    const draftCount = await this.prisma.ecriture.count({
      where: { companyId: company.companyId, fiscalYearId: id, validatedAt: null },
    });
    if (draftCount > 0) {
      throw new ConflictException(
        `Cannot close fiscal year "${fiscalYear.label}": ${draftCount} écriture(s) are still ` +
          'unvalidated (draft). Validate or delete them first.',
      );
    }

    return this.prisma.fiscalYear.update({
      where: { id: fiscalYear.id },
      data: { closedAt: new Date() },
    });
  }
}
