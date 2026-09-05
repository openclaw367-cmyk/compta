import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { ResultatFiscalService } from './resultat-fiscal.service';
import { ComputeResultatFiscalDto } from './dto/compute-resultat-fiscal.dto';
import { ResultatFiscalTraceQueryDto } from './dto/resultat-fiscal-trace-query.dto';
import { renderResultatFiscalPdf } from './resultat-fiscal-pdf';
import { renderResultatFiscalExcel } from './resultat-fiscal-excel';

@ApiTags('resultat-fiscal')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description: 'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('resultat-fiscal')
export class ResultatFiscalController {
  constructor(
    private readonly resultatFiscalService: ResultatFiscalService,
    private readonly companiesService: CompaniesService,
    private readonly fiscalYearsService: FiscalYearsService,
  ) {}

  @ApiOperation({
    summary:
      'Compute the détermination du résultat fiscal (2058-A/2058-B cadre III) for a fiscal year.',
    description:
      'NOT a pure ledger aggregation like every other liasse module — most réintégrations/déductions ' +
      'are tax judgment this app cannot derive, so they are supplied by the caller as declared ' +
      'adjustments. WJ (amendes, compte 6712) and WG (taxe véhicules, compte 63514) are computed as ' +
      'SUGGESTIONS only — never silently trusted; the response reports both the suggestion and ' +
      'whatever was confirmed. Asserts its own arithmetic (résultat fiscal = résultat comptable + ' +
      'réintégrations − déductions) but proves nothing about tax completeness.',
  })
  @Post('generate')
  generate(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeResultatFiscalDto) {
    return this.resultatFiscalService.generate(company, dto);
  }

  @ApiOperation({
    summary:
      'Trace a 2058 WJ/WG suggestion back to its contributing accounts — Tier 3, see CLAUDE.md "Traceability drill-down".',
    description:
      'A genuine read (GET, auto-fetched on row expand). Only WJ/WG are traceable — every other ' +
      "réintégration/déduction is user-declared, with no ledger source at all by this module's own " +
      'design, and is never offered a drill-down affordance. Traces the SUGGESTION only, never a ' +
      'manually-confirmed override (which may have no ledger backing at all).',
  })
  @Get('trace')
  traceConfirmableLine(
    @CurrentCompany() company: CompanyContext,
    @Query() dto: ResultatFiscalTraceQueryDto,
  ) {
    return this.resultatFiscalService.traceConfirmableLine(company, dto);
  }

  @ApiOperation({
    summary: 'Download the détermination du résultat fiscal as a PDF.',
    description:
      'Carries the same honesty banner as the live screen — never dropped in the export.',
  })
  @ApiProduces('application/pdf')
  @Post('export/pdf')
  async exportPdf(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: ComputeResultatFiscalDto,
    @Res() res: Response,
  ): Promise<void> {
    const [result, companyEntity, fiscalYear] = await Promise.all([
      this.resultatFiscalService.generate(company, dto),
      this.companiesService.findCurrent(company),
      this.fiscalYearsService.findOne(company, dto.fiscalYearId),
    ]);
    const pdf = await renderResultatFiscalPdf(result, companyEntity, fiscalYear);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="resultat-fiscal-${fiscalYear.label}.pdf"`,
    );
    res.send(Buffer.from(pdf));
  }

  @ApiOperation({
    summary: 'Download the détermination du résultat fiscal as an Excel workbook.',
    description:
      'Carries the same honesty banner as the live screen — never dropped in the export.',
  })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Post('export/excel')
  async exportExcel(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: ComputeResultatFiscalDto,
    @Res() res: Response,
  ): Promise<void> {
    const [result, fiscalYear] = await Promise.all([
      this.resultatFiscalService.generate(company, dto),
      this.fiscalYearsService.findOne(company, dto.fiscalYearId),
    ]);
    const excel = await renderResultatFiscalExcel(result, fiscalYear);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="resultat-fiscal-${fiscalYear.label}.xlsx"`,
    );
    res.send(excel);
  }
}
