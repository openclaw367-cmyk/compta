import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateTiersDto } from './dto/create-tiers.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

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

  @ApiOperation({
    summary: 'Rename an account.',
    description: 'Label only — CompteNum, class, and hierarchy are immutable once created.',
  })
  @ApiParam({ name: 'id' })
  @Patch(':id')
  rename(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accountsService.rename(company, id, dto);
  }

  @ApiOperation({
    summary: 'Create a tiers (compte auxiliaire) under a 401/411 collectif.',
    description: 'CompteNum is derived from the parent, not client-supplied.',
  })
  @ApiParam({ name: 'parentId' })
  @Post(':parentId/tiers')
  createTiers(
    @CurrentCompany() company: CompanyContext,
    @Param('parentId') parentId: string,
    @Body() dto: CreateTiersDto,
  ) {
    return this.accountsService.createTiers(company, parentId, dto);
  }

  @ApiOperation({ summary: 'List the tiers (comptes auxiliaires) under a collectif.' })
  @ApiParam({ name: 'parentId' })
  @Get(':parentId/tiers')
  listTiers(@CurrentCompany() company: CompanyContext, @Param('parentId') parentId: string) {
    return this.accountsService.listTiers(company, parentId);
  }
}
