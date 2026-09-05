import { Controller, Get, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description: 'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @ApiOperation({
    summary: "The landing screen's data — every figure already verified elsewhere in the app.",
    description:
      'Read-only, composes existing service methods (LiasseService, FinancialAnalysisService, ' +
      "LedgerService — see DashboardService's own doc comment), computes nothing new. Returns " +
      '{ available: false, reason } instead of an error response when the current fiscal year ' +
      "can't be computed (drafts present, no fiscal year, régime réel simplifié) — this is the " +
      'first screen the app shows, so it degrades to one honest banner rather than a raw 500.',
  })
  @ApiQuery({
    name: 'fiscalYearId',
    required: false,
    description:
      'Pin a specific fiscal year (the app-wide selector) — falls back to the open/most-recent one if omitted or unknown.',
  })
  @Get('summary')
  getSummary(
    @CurrentCompany() company: CompanyContext,
    @Query('fiscalYearId') fiscalYearId?: string,
  ) {
    return this.dashboard.getSummary(company, fiscalYearId);
  }
}
