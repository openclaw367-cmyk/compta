import { Controller, Get } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { DevService } from './dev.service';
import { DevIdsResponseDto } from './dto/dev-ids-response.dto';

@ApiTags('dev')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description: 'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('dev')
export class DevController {
  constructor(private readonly devService: DevService) {}

  @ApiOperation({
    summary:
      'Dev convenience only: seeded company, fiscal year, journals, and common account ' +
      'ids in one call, for grabbing ids to paste into other Swagger requests. Not mounted ' +
      'when NODE_ENV=production — see app.module.ts.',
  })
  @ApiResponse({ status: 200, type: DevIdsResponseDto })
  @Get('ids')
  getIds(@CurrentCompany() company: CompanyContext): Promise<DevIdsResponseDto> {
    return this.devService.getSeededIds(company);
  }
}
