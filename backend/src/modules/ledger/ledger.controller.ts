import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { LedgerService } from './ledger.service';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { TrialBalanceResponseDto } from './dto/trial-balance-response.dto';
import { AccountLedgerResponseDto } from './dto/account-ledger-response.dto';
import { renderTrialBalancePdf } from './trial-balance-pdf';
import { renderTrialBalanceExcel } from './trial-balance-excel';

@ApiTags('ledger')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description: 'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('ledger')
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly companiesService: CompaniesService,
    private readonly fiscalYearsService: FiscalYearsService,
  ) {}

  @ApiOperation({
    summary: 'Trial balance (balance générale): per-account debit/credit totals and balance.',
    description:
      'Scoped to a fiscal year, optionally further scoped to a date range. Includes draft ' +
      '(unvalidated) écritures as well as validated ones.',
  })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiResponse({ status: 200, type: TrialBalanceResponseDto })
  @Get('trial-balance')
  trialBalance(
    @CurrentCompany() company: CompanyContext,
    @Query() query: TrialBalanceQueryDto,
  ): Promise<TrialBalanceResponseDto> {
    return this.ledgerService.trialBalance(company, query);
  }

  @ApiOperation({
    summary: 'Grand livre for one account: its écriture lines with a running balance.',
    description: 'Same scoping (fiscal year, optional date range) as the trial balance.',
  })
  @ApiParam({ name: 'accountId' })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiResponse({ status: 200, type: AccountLedgerResponseDto })
  @Get('accounts/:accountId')
  accountLedger(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId') accountId: string,
    @Query() query: TrialBalanceQueryDto,
  ): Promise<AccountLedgerResponseDto> {
    return this.ledgerService.accountLedger(company, accountId, query);
  }

  @ApiOperation({ summary: 'Download the trial balance (balance générale) as a PDF.' })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiProduces('application/pdf')
  @Get('trial-balance/export/pdf')
  async exportTrialBalancePdf(
    @CurrentCompany() company: CompanyContext,
    @Query() query: TrialBalanceQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const [data, companyEntity, fiscalYear] = await Promise.all([
      this.ledgerService.trialBalance(company, query),
      this.companiesService.findCurrent(company),
      this.fiscalYearsService.findOne(company, query.fiscalYearId),
    ]);
    const pdf = await renderTrialBalancePdf(data, companyEntity, fiscalYear);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="balance-generale-${fiscalYear.label}.pdf"`,
    );
    res.send(Buffer.from(pdf));
  }

  @ApiOperation({ summary: 'Download the trial balance (balance générale) as an Excel workbook.' })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Get('trial-balance/export/excel')
  async exportTrialBalanceExcel(
    @CurrentCompany() company: CompanyContext,
    @Query() query: TrialBalanceQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const [data, fiscalYear] = await Promise.all([
      this.ledgerService.trialBalance(company, query),
      this.fiscalYearsService.findOne(company, query.fiscalYearId),
    ]);
    const excel = await renderTrialBalanceExcel(data, fiscalYear);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="balance-generale-${fiscalYear.label}.xlsx"`,
    );
    res.send(excel);
  }
}
