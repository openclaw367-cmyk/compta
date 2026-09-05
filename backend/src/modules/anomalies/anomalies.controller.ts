import { Controller, Get, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { AnomaliesService } from './anomalies.service';

@ApiTags('anomalies')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description: 'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomalies: AnomaliesService) {}

  @ApiOperation({
    summary:
      'Gentle, non-blocking anomaly flags — spending deviations and overdue unreconciled ' +
      'invoices. Computed fresh every call, never persisted, never gates anything.',
  })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @Get()
  getSummary(
    @CurrentCompany() company: CompanyContext,
    @Query('fiscalYearId') fiscalYearId: string,
  ) {
    return this.anomalies.getSummary(company, fiscalYearId);
  }
}
