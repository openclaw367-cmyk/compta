import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { FiscalYearsService } from './fiscal-years.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';

@ApiTags('fiscal-years')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description:
    'Tenant id — must name a company the caller (see Authorization header) is a member of.',
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

  @ApiOperation({
    summary: 'Close (lock) a fiscal year.',
    description:
      "Also generates and permanently archives this year's own FEC as part of the same " +
      'action — see CLAUDE.md "Operational readiness — clôture d\'exercice archival". Fails, ' +
      'leaving the year open, if the FEC cannot be generated (e.g. missing SIREN/RCI).',
  })
  @ApiParam({ name: 'id' })
  @Post(':id/close')
  close(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.fiscalYearsService.close(company, id);
  }

  @ApiOperation({
    summary: "This fiscal year's own tamper-evident FEC archive record, if one exists.",
    description:
      'Null for an open year, or a closed year never exported since closing (exporting it ' +
      'once backfills the record — see FecExportService.generate()).',
  })
  @ApiParam({ name: 'id' })
  @Get(':id/archive')
  getArchive(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.fiscalYearsService.getArchive(company, id);
  }
}
