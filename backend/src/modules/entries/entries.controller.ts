import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { EntriesService } from './entries.service';
import { CreateEcritureDto } from './dto/create-ecriture.dto';

@Controller('entries')
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateEcritureDto) {
    return this.entriesService.create(company, dto);
  }

  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.entriesService.findAll(company);
  }

  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.entriesService.findOne(company, id);
  }

  @Patch(':id')
  update(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: CreateEcritureDto,
  ) {
    return this.entriesService.update(company, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.entriesService.remove(company, id);
  }

  @Post(':id/validate')
  validate(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.entriesService.validate(company, id);
  }

  @Post(':id/reverse')
  reverse(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.entriesService.reverse(company, id);
  }
}
