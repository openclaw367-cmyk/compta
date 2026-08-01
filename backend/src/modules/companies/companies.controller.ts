import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @ApiOperation({
    summary:
      'Create a tenant (dossier). Not tenant-scoped — this is how a tenant comes into existence.',
  })
  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  @ApiOperation({
    summary: 'The company the frontend should auto-select today (single-company UX).',
  })
  @ApiHeader({
    name: 'x-company-id',
    required: false,
    description: 'Tenant id. Falls back to the single existing company if omitted.',
  })
  @Get('current')
  findCurrent(@CurrentCompany() company: CompanyContext) {
    return this.companiesService.findCurrent(company);
  }

  @ApiOperation({
    summary: 'Edit the current company profile (name, SIREN/RCI, jurisdiction, address, ...).',
    description: 'Partial update — only the supplied fields are changed.',
  })
  @ApiHeader({
    name: 'x-company-id',
    required: false,
    description: 'Tenant id. Falls back to the single existing company if omitted.',
  })
  @Patch('current')
  updateCurrent(@CurrentCompany() company: CompanyContext, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.updateCurrent(company, dto);
  }
}
