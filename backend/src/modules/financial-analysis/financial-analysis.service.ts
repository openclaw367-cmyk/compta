import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CashFlowService } from '../cash-flow/cash-flow.service';
import {
  assertCashFlowReconciles,
  computeCashFlowStatement,
} from '../cash-flow/cash-flow-statement';
import { FinancialAnalysisResult, computeFinancialAnalysis } from './financial-analysis';
import { ComputeFinancialAnalysisDto } from './dto/compute-financial-analysis.dto';

/**
 * Retraitement analytique — see financial-analysis.ts for the compute
 * logic and every scope decision. This service is the fetch/wiring
 * layer: it builds on CashFlowService.buildContext() (the SAME fetch
 * cash-flow.service.ts's own generate() uses), then computes the
 * tableau de flux itself here too (rather than calling generate()
 * again, which would re-run buildContext() a second time) — one fetch,
 * two independent consumers (the flux statement and the retraitement
 * analytique), guaranteeing the BFR tie-out holds by construction.
 */
@Injectable()
export class FinancialAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashFlowService: CashFlowService,
  ) {}

  async generate(
    company: CompanyContext,
    dto: ComputeFinancialAnalysisDto,
  ): Promise<FinancialAnalysisResult> {
    const context = await this.cashFlowService.buildContext(company, dto.fiscalYearId);

    const draftCount = await this.prisma.ecriture.count({
      where: {
        companyId: company.companyId,
        fiscalYearId: context.fiscalYear.id,
        validatedAt: null,
      },
    });
    if (draftCount > 0) {
      throw new ConflictException(
        `Cannot compute the retraitement analytique: ${draftCount} écriture(s) in this fiscal ` +
          'year are still unvalidated (draft). Validate them first.',
      );
    }

    const cashFlowStatement = computeCashFlowStatement(context);
    assertCashFlowReconciles(cashFlowStatement);

    return computeFinancialAnalysis({
      openingBilan: context.openingBilan,
      closingBilan: context.closingBilan,
      closingCompteResultat: context.closingCompteResultat,
      cashFlowStatement,
      openingTvaDeductibleAutres: context.openingTvaDeductibleAutres,
      closingTvaDeductibleAutres: context.closingTvaDeductibleAutres,
      closingTvaDeductibleImmobilisations: context.closingTvaDeductibleImmobilisations,
      closingCreancesSurCessions: context.closingCreancesSurCessions,
    });
  }
}
