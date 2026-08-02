import { Controller, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { ANouveauService } from './a-nouveau.service';

@ApiTags('a-nouveau')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('fiscal-years/:fiscalYearId/a-nouveau')
export class ANouveauController {
  constructor(private readonly aNouveauService: ANouveauService) {}

  @ApiOperation({
    summary:
      "Generate the à-nouveau (opening balance carry-forward) écriture for a fiscal year " +
      'from its closed predecessor. Validated immediately; refuses if the predecessor is not ' +
      'closed or à-nouveau entries already exist for this year.',
  })
  @ApiParam({ name: 'fiscalYearId' })
  @Post()
  generate(@CurrentCompany() company: CompanyContext, @Param('fiscalYearId') fiscalYearId: string) {
    return this.aNouveauService.generate(company, fiscalYearId);
  }
}
