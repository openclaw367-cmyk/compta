import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { CashFlowService } from '../cash-flow/cash-flow.service';
import {
  assertCashFlowReconciles,
  computeCashFlowStatement,
} from '../cash-flow/cash-flow-statement';
import { FinancialAnalysisResult, computeFinancialAnalysis } from './financial-analysis';
import { ComputeFinancialAnalysisDto } from './dto/compute-financial-analysis.dto';
import { FinancialAnalysisTraceQueryDto } from './dto/financial-analysis-trace-query.dto';
import {
  FinancialAnalysisFormulaTraceResult,
  traceFinancialAnalysisFormula,
} from './financial-analysis-trace';

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

  /**
   * Traceability drill-down, Tier 4 — SIG cascade "formula trace". See
   * CLAUDE.md "Traceability drill-down (Tier 4)" and
   * `financial-analysis-trace.ts`'s own doc comment for the design
   * (margeCommerciale/valeurAjoutee/ebe only — everything else is
   * either already covered by `cash-flow-trace.ts` or is a dimensionless
   * ratio, not a ledger aggregation). Re-runs the SAME `generate()` flow
   * to get the official value for `dto.key` and `buildContext()` again
   * for the raw CDR accounts — the service-layer draft-block/
   * reconciliation guards apply identically to a trace as to a full
   * generate(), same discipline as `CashFlowService.traceCaf()`.
   */
  async traceFormula(
    company: CompanyContext,
    dto: FinancialAnalysisTraceQueryDto,
  ): Promise<FinancialAnalysisFormulaTraceResult> {
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
        `Cannot trace the retraitement analytique: ${draftCount} écriture(s) in this fiscal year ` +
          'are still unvalidated (draft). Validate them first.',
      );
    }

    const cashFlowStatement = computeCashFlowStatement(context);
    assertCashFlowReconciles(cashFlowStatement);
    const result = computeFinancialAnalysis({
      openingBilan: context.openingBilan,
      closingBilan: context.closingBilan,
      closingCompteResultat: context.closingCompteResultat,
      cashFlowStatement,
      openingTvaDeductibleAutres: context.openingTvaDeductibleAutres,
      closingTvaDeductibleAutres: context.closingTvaDeductibleAutres,
      closingTvaDeductibleImmobilisations: context.closingTvaDeductibleImmobilisations,
      closingCreancesSurCessions: context.closingCreancesSurCessions,
    });

    return traceFinancialAnalysisFormula(
      dto.key,
      context.closingCdrAccounts,
      Money.fromString(result.sig[dto.key]),
    );
  }
}
