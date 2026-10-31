import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { CashFlowService } from './cash-flow.service';
import { ComputeCashFlowDto } from './dto/compute-cash-flow.dto';
import { CashFlowTraceCafQueryDto } from './dto/cash-flow-trace-caf-query.dto';
import { CashFlowTraceDeltaLineQueryDto } from './dto/cash-flow-trace-delta-line-query.dto';
import { CashFlowTraceOpeningLineQueryDto } from './dto/cash-flow-trace-opening-line-query.dto';
import { renderCashFlowPdf } from './cash-flow-pdf';
import { renderCashFlowExcel } from './cash-flow-excel';

@ApiTags('cash-flow')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description:
    'Tenant id — must name a company the caller (see Authorization header) is a member of.',
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

  @ApiOperation({
    summary:
      "Trace la CAF jusqu'à ses propres termes (Tier 4 — voir CLAUDE.md « Traceability drill-down (Tier 4) »).",
    description:
      "GET, auto-fetched à l'ouverture de la ligne, jamais une action déclenchée. Chaque terme qui " +
      'se décompose en codes CDR peut être retracé plus loin via le /liasse/cdr-line-trace déjà ' +
      'existant (Tier 1) — ce module ne duplique jamais cette logique.',
  })
  @Get('trace-caf')
  traceCaf(@CurrentCompany() company: CompanyContext, @Query() dto: CashFlowTraceCafQueryDto) {
    return this.cashFlowService.traceCaf(company, dto);
  }

  @ApiOperation({
    summary: "Trace une ligne de flux « delta de ligne du bilan » jusqu'à ses codes (Tier 4).",
    description:
      'Couvre variationCreancesClients/variationStocks/variationDettesExploitation/' +
      'variationDettesSurImmobilisations/variationEmprunts/variationCapital — voir cash-flow-trace.ts ' +
      'pour la liste complète des lignes refusées à la place.',
  })
  @Get('trace-delta-line')
  traceDeltaLine(
    @CurrentCompany() company: CompanyContext,
    @Query() dto: CashFlowTraceDeltaLineQueryDto,
  ) {
    return this.cashFlowService.traceDeltaLine(company, dto);
  }

  @ApiOperation({
    summary: "Trace le côté OUVERTURE (à-nouveau) d'une ligne jusqu'à ses comptes (Tier 4).",
    description:
      'Le côté CLÔTURE de la même ligne se retrace via le /liasse/bilan-line-trace déjà existant ' +
      "(regime=REEL_NORMAL) — cet endpoint n'existe que parce que ce côté-là n'a pas d'équivalent.",
  })
  @Get('trace-opening-bilan-line')
  traceOpeningBilanLine(
    @CurrentCompany() company: CompanyContext,
    @Query() dto: CashFlowTraceOpeningLineQueryDto,
  ) {
    return this.cashFlowService.traceOpeningBilanLine(company, dto);
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
