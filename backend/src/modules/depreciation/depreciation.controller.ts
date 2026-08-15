import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { DepreciationService } from './depreciation.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { CessionFixedAssetDto } from './dto/cession-fixed-asset.dto';

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

  @ApiOperation({ summary: 'Get one fixed asset by id, with valeurBrute/amortissementsCumules/vnc.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.depreciationService.findOneWithSummary(company, id);
  }

  @ApiOperation({ summary: "Get the asset's already-computed plan d'amortissement, read-only." })
  @ApiParam({ name: 'id' })
  @Get(':id/schedule')
  findSchedule(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.depreciationService.findSchedule(company, id);
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

  @ApiOperation({
    summary: "Post a period's dotation aux amortissements as a real, validated écriture.",
    description:
      'Goes through EntriesService.create()/validate() — same balance check and fiscal-year-open ' +
      'guard as any manually-entered écriture. Refuses if this dotation was already posted, or if ' +
      'posting it would exceed the depreciable base.',
  })
  @ApiParam({ name: 'entryId' })
  @Post('entries/:entryId/post')
  postDotation(@CurrentCompany() company: CompanyContext, @Param('entryId') entryId: string) {
    return this.depreciationService.postDotation(company, entryId);
  }

  @ApiOperation({
    summary: 'Dispose of (céder) a fixed asset — posts the disposal écriture(s) as real, validated entries.',
    description:
      'Posts a prorated final dotation first if the disposal year is mid-year (30E/360 day-count from ' +
      "the fiscal year's start or serviceStartDate, whichever is later), then the disposal écriture " +
      "itself (débit amortissements cumulés + débit VNC = crédit valeur brute; débit compte de " +
      "règlement = crédit produit de cession). All through EntriesService.create()/validate(). " +
      "Refuses if already disposed, if a prior fiscal year's dotation isn't posted, or if the " +
      'disposal year was already posted at the wrong (full-year) amount.',
  })
  @ApiParam({ name: 'id' })
  @Post(':id/cession')
  disposeFixedAsset(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: CessionFixedAssetDto,
  ) {
    return this.depreciationService.disposeFixedAsset(company, id, dto);
  }
}
