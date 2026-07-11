import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { JournalsService } from './journals.service';
import { CreateJournalDto } from './dto/create-journal.dto';

@Controller('journals')
export class JournalsController {
  constructor(private readonly journalsService: JournalsService) {}

  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateJournalDto) {
    return this.journalsService.create(company, dto);
  }

  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.journalsService.findAll(company);
  }

  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.journalsService.findOne(company, id);
  }
}
