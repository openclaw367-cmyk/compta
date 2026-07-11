import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { FiscalYearsService } from './fiscal-years.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';

@Controller('fiscal-years')
export class FiscalYearsController {
  constructor(private readonly fiscalYearsService: FiscalYearsService) {}

  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateFiscalYearDto) {
    return this.fiscalYearsService.create(company, dto);
  }

  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.fiscalYearsService.findAll(company);
  }

  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.fiscalYearsService.findOne(company, id);
  }

  @Post(':id/close')
  close(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.fiscalYearsService.close(company, id);
  }
}
