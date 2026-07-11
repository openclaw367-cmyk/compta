import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { VatService } from './vat.service';
import { CreateVatRateDto } from './dto/create-vat-rate.dto';

@Controller('vat')
export class VatController {
  constructor(private readonly vatService: VatService) {}

  @Post('rates')
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateVatRateDto) {
    return this.vatService.create(company, dto);
  }

  @Get('rates')
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.vatService.findAll(company);
  }

  @Get('rates/:id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.vatService.findOne(company, id);
  }

  @Post('declaration')
  computeDeclaration() {
    return this.vatService.computeDeclaration();
  }
}
