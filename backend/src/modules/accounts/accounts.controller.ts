import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';

@ApiTags('accounts')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @ApiOperation({ summary: 'Create a PCG chart-of-accounts entry.' })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateAccountDto) {
    return this.accountsService.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's chart of accounts." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.accountsService.findAll(company);
  }

  @ApiOperation({ summary: 'Get one account by id.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.accountsService.findOne(company, id);
  }
}
