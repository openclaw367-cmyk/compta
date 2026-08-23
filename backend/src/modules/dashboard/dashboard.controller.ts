import { Controller, Get } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
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
  @Get('summary')
  getSummary(@CurrentCompany() company: CompanyContext) {
    return this.dashboard.getSummary(company);
  }
}
