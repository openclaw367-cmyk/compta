import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { FiscalYearsService } from './fiscal-years.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';

@ApiTags('fiscal-years')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('fiscal-years')
export class FiscalYearsController {
  constructor(private readonly fiscalYearsService: FiscalYearsService) {}

  @ApiOperation({ summary: 'Create a fiscal year (exercice comptable).' })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateFiscalYearDto) {
    return this.fiscalYearsService.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's fiscal years." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.fiscalYearsService.findAll(company);
  }

  @ApiOperation({ summary: 'Get one fiscal year by id.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.fiscalYearsService.findOne(company, id);
  }

  @ApiOperation({ summary: 'Close (lock) a fiscal year.' })
  @ApiParam({ name: 'id' })
  @Post(':id/close')
  close(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.fiscalYearsService.close(company, id);
  }
}
