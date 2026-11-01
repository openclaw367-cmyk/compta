import { Injectable, NotFoundException } from '@nestjs/common';
import { CostCenter } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { AnalyticalLigne, AnalyticalReport, computeAnalyticalReport } from './analytical-report';

/**
 * Roadmap item 2b ("Comptabilité analytique"). CRUD for the reference
 * entity (create + list only — no delete/update, same "no delete/
 * deactivate on a reference entity referenced by immutable écritures"
 * precedent as Journal/VatRate/FiscalYear — see CLAUDE.md "Known scope
 * boundaries") plus the read-only analytical report.
 */
@Injectable()
export class CostCentersService {
  constructor(private readonly prisma: PrismaService) {}

  create(company: CompanyContext, dto: CreateCostCenterDto): Promise<CostCenter> {
    return this.prisma.costCenter.create({
      data: { companyId: company.companyId, code: dto.code, label: dto.label },
    });
  }

  findAll(company: CompanyContext): Promise<CostCenter[]> {
    return this.prisma.costCenter.findMany({
      where: { companyId: company.companyId },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(company: CompanyContext, id: string): Promise<CostCenter> {
    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!costCenter) {
      throw new NotFoundException(`Cost center ${id} not found`);
    }
    return costCenter;
  }

  /**
   * The P&L broken out by cost center for one fiscal year — reads
   * VALIDATED-only lines (matching the compliance compte de résultat
   * this ties against; a draft simply isn't counted yet, no hard
   * drafts-block the way liasse generation has, since this is a
   * day-to-day management report, not a compliance export).
   */
  async computeReport(company: CompanyContext, fiscalYearId: string): Promise<AnalyticalReport> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }

    const [lignes, costCenters] = await Promise.all([
      this.prisma.ecritureLigne.findMany({
        where: {
          companyId: company.companyId,
          ecriture: { fiscalYearId: fiscalYear.id, validatedAt: { not: null } },
          compte: { pcgClass: { in: [6, 7] } },
        },
        include: { compte: true },
      }),
      this.prisma.costCenter.findMany({ where: { companyId: company.companyId } }),
    ]);

    const analyticalLignes: AnalyticalLigne[] = lignes.map((ligne) => ({
      compteNumber: ligne.compte.number,
      pcgClass: ligne.compte.pcgClass,
      debit: ligne.debit,
      credit: ligne.credit,
      costCenterId: ligne.costCenterId,
    }));

    return computeAnalyticalReport(fiscalYear.id, analyticalLignes, costCenters);
  }
}
