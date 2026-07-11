import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  /** The company the frontend should auto-select today (single-company UX). */
  @Get('current')
  findCurrent(@CurrentCompany() company: CompanyContext) {
    return this.companiesService.findCurrent(company);
  }
}
