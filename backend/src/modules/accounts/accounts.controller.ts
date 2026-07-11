import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateAccountDto) {
    return this.accountsService.create(company, dto);
  }

  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.accountsService.findAll(company);
  }

  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.accountsService.findOne(company, id);
  }
}
