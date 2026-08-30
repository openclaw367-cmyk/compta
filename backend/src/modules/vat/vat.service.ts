import {
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { VatRate } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateVatRateDto } from './dto/create-vat-rate.dto';
import { ComputeVatDeclarationDto } from './dto/compute-vat-declaration.dto';
import { Ca3LineTraceQueryDto } from './dto/ca3-line-trace-query.dto';
import { Ca3Declaration, computeCa3Declaration } from './ca3-declaration';
import { MonacoDeclaration, computeMonacoDeclaration } from './monaco-declaration';
import { Ca3LigneWithAccount, Ca3LineTraceResult, traceCa3RateColumn } from './ca3-line-trace';

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
   * Computes the declaration for the company's own jurisdiction: the
   * French CA3 (régime réel normal, basic case —
   * specs/vat-ca3-implementation-spec.md) for FR, the Monaco DSF
   * declaration (basic case — specs/vat-monaco-implementation-spec.md)
   * for MC. These are genuinely different declarations — different
   * form, different line numbers, filed with a different tax authority
   * — not variants of one computation, even though (per the Monaco
   * spec's confirmed account model, §5) they happen to read the same
   * PCG accounts.
   *
   * Only validated écritures are read, and the whole computation refuses
   * if any écriture in the period is still a draft — same rule and same
   * reasoning as FecExportService.generate(): a declaration computed
   * around missing drafts would be silently wrong, not just incomplete.
   * The actual arithmetic lives in the pure, independently-tested
   * computeCa3Declaration() / computeMonacoDeclaration() — this method
   * only fetches, then delegates to whichever one matches jurisdiction.
   */
  async computeDeclaration(
    company: CompanyContext,
    dto: ComputeVatDeclarationDto,
  ): Promise<Ca3Declaration | MonacoDeclaration> {
    const { companyRecord, mappedLignes, mappedRates } = await this.fetchDeclarationContext(
      company,
      dto.periodStart,
      dto.periodEnd,
    );

    if (companyRecord.jurisdiction === 'FR') {
      return computeCa3Declaration(mappedLignes, mappedRates, dto.periodStart, dto.periodEnd);
    }
    if (companyRecord.jurisdiction === 'MC') {
      return computeMonacoDeclaration(mappedLignes, mappedRates, dto.periodStart, dto.periodEnd);
    }
    throw new NotImplementedException(
      `Unknown jurisdiction "${String(companyRecord.jurisdiction)}".`,
    );
  }

  /**
   * Traceability drill-down, Tier 3 — CA3 lignes 08/09/9B/T6. See
   * CLAUDE.md "Traceability drill-down" and `ca3-line-trace.ts`'s own
   * doc comment. FR (CA3) only — Monaco's own declaration has a
   * different rate-line shape (ligne 30/32, not 08/09/9B/T6) and isn't
   * in scope for this pass.
   */
  async traceCa3Line(
    company: CompanyContext,
    dto: Ca3LineTraceQueryDto,
  ): Promise<Ca3LineTraceResult> {
    const ctx = await this.fetchDeclarationContext(company, dto.periodStart, dto.periodEnd);
    if (ctx.companyRecord.jurisdiction !== 'FR') {
      throw new NotImplementedException(
        "CA3 line tracing is only available for an FR-jurisdiction company — Monaco's own " +
          'declaration has a different rate-line shape, not in scope for this pass.',
      );
    }
    const enriched: Ca3LigneWithAccount[] = ctx.rawLignes.map((ligne) => ({
      compteNumber: ligne.compte.number,
      pcgClass: ligne.compte.pcgClass,
      debit: ligne.debit,
      credit: ligne.credit,
      vatRateId: ligne.vatRateId,
      accountId: ligne.compte.id,
      accountLabel: ligne.compte.label,
    }));
    return traceCa3RateColumn(
      enriched,
      ctx.mappedRates,
      dto.periodStart,
      dto.periodEnd,
      dto.ligne,
      dto.column,
    );
  }

  /**
   * Shared fetch for computeDeclaration()/traceCa3Line() — company
   * lookup, the draft-block guard, and the period-scoped validated
   * ledger lines + VAT rates. Extracted so the trace reuses the
   * IDENTICAL fetch computeDeclaration() already used, not a
   * separately-derived one.
   */
  private async fetchDeclarationContext(
    company: CompanyContext,
    periodStartStr: string,
    periodEndStr: string,
  ) {
    const companyRecord = await this.prisma.company.findFirst({
      where: { id: company.companyId },
    });
    if (!companyRecord) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
    }

    const periodStart = new Date(periodStartStr);
    const periodEnd = new Date(periodEndStr);

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

    const [rawLignes, vatRates] = await Promise.all([
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

    const mappedLignes = rawLignes.map((ligne) => ({
      compteNumber: ligne.compte.number,
      pcgClass: ligne.compte.pcgClass,
      debit: ligne.debit,
      credit: ligne.credit,
      vatRateId: ligne.vatRateId,
    }));
    const mappedRates = vatRates.map((rate) => ({ id: rate.id, ratePercent: rate.ratePercent }));

    return { companyRecord, rawLignes, mappedLignes, mappedRates };
  }
}
