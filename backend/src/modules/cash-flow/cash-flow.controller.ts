import { Body, Controller, Post, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { CashFlowService } from './cash-flow.service';
import { ComputeCashFlowDto } from './dto/compute-cash-flow.dto';
import { renderCashFlowPdf } from './cash-flow-pdf';
import { renderCashFlowExcel } from './cash-flow-excel';

@ApiTags('cash-flow')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('cash-flow')
export class CashFlowController {
  constructor(
    private readonly cashFlowService: CashFlowService,
    private readonly companiesService: CompaniesService,
    private readonly fiscalYearsService: FiscalYearsService,
  ) {}

  @ApiOperation({
    summary: 'Generate the tableau des flux de trésorerie (indirect method) for a fiscal year.',
    description:
      'Reads the bilan/compte de résultat already built by the liasse module, across the opening ' +
      "(this fiscal year's own à-nouveau lines) and closing (this fiscal year's full ledger) states. " +
      'Refuses if any écriture in the fiscal year is still a draft, and throws if the three flux ' +
      'sections do not reconcile to the actual change in trésorerie — never plugs a mismatch.',
  })
  @Post('generate')
  generate(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeCashFlowDto) {
    return this.cashFlowService.generate(company, dto);
  }

  @ApiOperation({ summary: 'Download the tableau des flux de trésorerie as a PDF.' })
  @ApiProduces('application/pdf')
  @Post('export/pdf')
  async exportPdf(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: ComputeCashFlowDto,
    @Res() res: Response,
  ): Promise<void> {
    const [statement, companyEntity, fiscalYear] = await Promise.all([
      this.cashFlowService.generate(company, dto),
      this.companiesService.findCurrent(company),
      this.fiscalYearsService.findOne(company, dto.fiscalYearId),
    ]);
    const pdf = await renderCashFlowPdf(statement, companyEntity, fiscalYear);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="flux-tresorerie-${fiscalYear.label}.pdf"`,
    );
    res.send(Buffer.from(pdf));
  }

  @ApiOperation({ summary: 'Download the tableau des flux de trésorerie as an Excel workbook.' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Post('export/excel')
  async exportExcel(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: ComputeCashFlowDto,
    @Res() res: Response,
  ): Promise<void> {
    const [statement, fiscalYear] = await Promise.all([
      this.cashFlowService.generate(company, dto),
      this.fiscalYearsService.findOne(company, dto.fiscalYearId),
    ]);
    const excel = await renderCashFlowExcel(statement, fiscalYear);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="flux-tresorerie-${fiscalYear.label}.xlsx"`,
    );
    res.send(excel);
  }
}
