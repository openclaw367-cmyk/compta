import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { DepreciationService } from './depreciation.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';

@Controller('depreciation/fixed-assets')
export class DepreciationController {
  constructor(private readonly depreciationService: DepreciationService) {}

  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateFixedAssetDto) {
    return this.depreciationService.create(company, dto);
  }

  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.depreciationService.findAll(company);
  }

  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.depreciationService.findOne(company, id);
  }

  @Post(':id/schedule')
  generateSchedule(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.depreciationService.generateSchedule(company, id);
  }
}
