import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser } from '../../common/auth/request-with-user';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @ApiOperation({
    summary:
      'Create a company (dossier), scaffolded with the standard chart of accounts and the five ' +
      'standard journals — immediately usable, not a bare row. The caller becomes its OWNER. ' +
      'Requires a valid access token but no company context yet, since this is how a tenant ' +
      'comes into existence for this user.',
  })
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto, { ownerUserId: user.id });
  }

  @ApiOperation({
    summary: "List every company the caller is a member of, with the caller's own role on each.",
    description: 'This is what the company picker chooses from.',
  })
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.findAllForUser(user.id);
  }

  @ApiOperation({
    summary: 'The currently-selected company (see the "x-company-id" header).',
  })
  @Get('current')
  findCurrent(@CurrentCompany() company: CompanyContext) {
    return this.companiesService.findCurrent(company);
  }

  @ApiOperation({
    summary: 'Edit the current company profile (name, SIREN/RCI, jurisdiction, address, ...).',
    description: 'Partial update — only the supplied fields are changed.',
  })
  @Patch('current')
  updateCurrent(@CurrentCompany() company: CompanyContext, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.updateCurrent(company, dto);
  }
}
