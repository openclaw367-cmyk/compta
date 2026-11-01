import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CostCentersService } from './cost-centers.service';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';

@ApiTags('cost-centers')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description:
    'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('cost-centers')
export class CostCentersController {
  constructor(private readonly costCenters: CostCentersService) {}

  @ApiOperation({
    summary:
      'Create a cost center / analytical dimension (roadmap item 2b "Comptabilité analytique").',
  })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateCostCenterDto) {
    return this.costCenters.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's cost centers." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.costCenters.findAll(company);
  }

  // Registered BEFORE @Get(':id') — otherwise Nest would parse
  // "/cost-centers/report" as a request for the cost center with id
  // "report". Same route-ordering landmine CLAUDE.md "Search —
  // écritures by libellé/amount" already documents and fixed once.
  @ApiOperation({
    summary:
      'P&L broken out by cost center for one fiscal year — read-only, validated écritures only. ' +
      'See CLAUDE.md "Comptabilité analytique".',
  })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @Get('report/by-fiscal-year')
  report(@CurrentCompany() company: CompanyContext, @Query('fiscalYearId') fiscalYearId: string) {
    return this.costCenters.computeReport(company, fiscalYearId);
  }

  @ApiOperation({ summary: 'Fetch one cost center.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.costCenters.findOne(company, id);
  }
}
