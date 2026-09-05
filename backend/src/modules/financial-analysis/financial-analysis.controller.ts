import { Body, Controller, Post, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { FinancialAnalysisService } from './financial-analysis.service';
import { ComputeFinancialAnalysisDto } from './dto/compute-financial-analysis.dto';
import { renderFinancialAnalysisPdf } from './financial-analysis-pdf';
import { renderFinancialAnalysisExcel } from './financial-analysis-excel';

@ApiTags('financial-analysis')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('financial-analysis')
export class FinancialAnalysisController {
  constructor(
    private readonly financialAnalysisService: FinancialAnalysisService,
    private readonly companiesService: CompaniesService,
    private readonly fiscalYearsService: FiscalYearsService,
  ) {}

  @ApiOperation({
    summary:
      'Compute the retraitement analytique (SIG, BFR/FR/trésorerie, ratios) for a fiscal year.',
    description:
      'Fully deterministic — every figure is ledger-derived, no assumption (WACC/DCF/multiples are ' +
      'out of scope, deferred to a future Valuation module). Reuses the tableau de flux de ' +
      "trésorerie's own fetch, so BFR here ties to that module's ΔBFR by construction. Refuses if " +
      'any écriture in the fiscal year is still a draft, and throws if BFR or trésorerie nette fail ' +
      'to tie — never plugs a mismatch.',
  })
  @Post('generate')
  generate(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeFinancialAnalysisDto) {
    return this.financialAnalysisService.generate(company, dto);
  }

  @ApiOperation({ summary: 'Download the analyse financière as a PDF.' })
  @ApiProduces('application/pdf')
  @Post('export/pdf')
  async exportPdf(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: ComputeFinancialAnalysisDto,
    @Res() res: Response,
  ): Promise<void> {
    const [result, companyEntity, fiscalYear] = await Promise.all([
      this.financialAnalysisService.generate(company, dto),
      this.companiesService.findCurrent(company),
      this.fiscalYearsService.findOne(company, dto.fiscalYearId),
    ]);
    const pdf = await renderFinancialAnalysisPdf(result, companyEntity, fiscalYear);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="analyse-financiere-${fiscalYear.label}.pdf"`,
    );
    res.send(Buffer.from(pdf));
  }

  @ApiOperation({ summary: 'Download the analyse financière as an Excel workbook.' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Post('export/excel')
  async exportExcel(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: ComputeFinancialAnalysisDto,
    @Res() res: Response,
  ): Promise<void> {
    const [result, fiscalYear] = await Promise.all([
      this.financialAnalysisService.generate(company, dto),
      this.fiscalYearsService.findOne(company, dto.fiscalYearId),
    ]);
    const excel = await renderFinancialAnalysisExcel(result, fiscalYear);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="analyse-financiere-${fiscalYear.label}.xlsx"`,
    );
    res.send(excel);
  }
}
