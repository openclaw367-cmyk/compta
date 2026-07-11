import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { JournalsService } from './journals.service';
import { CreateJournalDto } from './dto/create-journal.dto';

@ApiTags('journals')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('journals')
export class JournalsController {
  constructor(private readonly journalsService: JournalsService) {}

  @ApiOperation({ summary: 'Create a journal comptable (e.g. AC, VE, BQ, OD, AN).' })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateJournalDto) {
    return this.journalsService.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's journals." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.journalsService.findAll(company);
  }

  @ApiOperation({ summary: 'Get one journal by id.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.journalsService.findOne(company, id);
  }
}
