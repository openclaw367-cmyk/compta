import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { VatRate } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateVatRateDto } from './dto/create-vat-rate.dto';
import { ComputeVatDeclarationDto } from './dto/compute-vat-declaration.dto';
import { Ca3Declaration, computeCa3Declaration } from './ca3-declaration';

@Injectable()
export class VatService {
  constructor(private readonly prisma: PrismaService) {}

  create(company: CompanyContext, dto: CreateVatRateDto): Promise<VatRate> {
    return this.prisma.vatRate.create({
      data: {
        companyId: company.companyId,
        label: dto.label,
        ratePercent: dto.ratePercent,
        validFrom: new Date(dto.validFrom),
        validTo: dto.validTo ? new Date(dto.validTo) : undefined,
      },
    });
  }

  findAll(company: CompanyContext): Promise<VatRate[]> {
    return this.prisma.vatRate.findMany({
      where: { companyId: company.companyId },
      orderBy: { validFrom: 'desc' },
    });
  }

  async findOne(company: CompanyContext, id: string): Promise<VatRate> {
    const rate = await this.prisma.vatRate.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!rate) {
      throw new NotFoundException(`VAT rate ${id} not found`);
    }
    return rate;
  }

  /**
   * French CA3 (régime réel normal), basic-case only — see
   * specs/vat-ca3-implementation-spec.md for the line spec, account
   * mapping, and exactly what's implemented vs. deferred. Monaco is not
   * implemented — see CLAUDE.md "Monaco compliance" and the spec's
   * Monaco inventory; jurisdiction is not branched on here because only
   * the FR path exists so far.
   *
   * Only validated écritures are read, and the whole computation refuses
   * if any écriture in the period is still a draft — same rule and same
   * reasoning as FecExportService.generate(): a declaration computed
   * around missing drafts would be silently wrong, not just incomplete.
   * The actual arithmetic lives in the pure, independently-tested
   * computeCa3Declaration() — this method only fetches and delegates.
   */
  async computeDeclaration(
    company: CompanyContext,
    dto: ComputeVatDeclarationDto,
  ): Promise<Ca3Declaration> {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);

    const draftCount = await this.prisma.ecriture.count({
      where: {
        companyId: company.companyId,
        ecritureDate: { gte: periodStart, lte: periodEnd },
        validatedAt: null,
      },
    });
    if (draftCount > 0) {
      throw new ConflictException(
        `Cannot compute the VAT declaration: ${draftCount} écriture(s) dated in this period are ` +
          'still unvalidated (draft). Validate them first.',
      );
    }

    const [lignes, vatRates] = await Promise.all([
      this.prisma.ecritureLigne.findMany({
        where: {
          companyId: company.companyId,
          ecriture: {
            ecritureDate: { gte: periodStart, lte: periodEnd },
            validatedAt: { not: null },
          },
        },
        include: { compte: true },
      }),
      this.prisma.vatRate.findMany({ where: { companyId: company.companyId } }),
    ]);

    return computeCa3Declaration(
      lignes.map((ligne) => ({
        compteNumber: ligne.compte.number,
        pcgClass: ligne.compte.pcgClass,
        debit: ligne.debit,
        credit: ligne.credit,
        vatRateId: ligne.vatRateId,
      })),
      vatRates.map((rate) => ({ id: rate.id, ratePercent: rate.ratePercent })),
      dto.periodStart,
      dto.periodEnd,
    );
  }
}
