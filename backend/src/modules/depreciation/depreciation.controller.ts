import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { DepreciationService } from './depreciation.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';

@ApiTags('depreciation')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('depreciation/fixed-assets')
export class DepreciationController {
  constructor(private readonly depreciationService: DepreciationService) {}

  @ApiOperation({ summary: 'Register a fixed asset (immobilisation).' })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateFixedAssetDto) {
    return this.depreciationService.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's fixed assets." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.depreciationService.findAll(company);
  }

  @ApiOperation({ summary: 'Get one fixed asset by id.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.depreciationService.findOne(company, id);
  }

  @ApiOperation({
    summary: 'Compute and persist the straight-line depreciation schedule.',
    description: 'DECLINING method assets are rejected — not implemented yet (see CLAUDE.md).',
  })
  @ApiParam({ name: 'id' })
  @Post(':id/schedule')
  generateSchedule(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.depreciationService.generateSchedule(company, id);
  }
}
