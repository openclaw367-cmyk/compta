import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';

@ApiTags('bank-accounts')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly bankAccounts: BankAccountsService) {}

  @ApiOperation({
    summary: 'Create a bank account, linked to one 512/514/516/517-family PCG account.',
  })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateBankAccountDto) {
    return this.bankAccounts.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's bank accounts." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.bankAccounts.findAll(company);
  }
}
