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
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { EntriesService } from './entries.service';
import { CreateEcritureDto } from './dto/create-ecriture.dto';

@ApiTags('entries')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('entries')
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @ApiOperation({
    summary: 'Create a draft écriture (must balance; see CLAUDE.md "Ledger integrity").',
  })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateEcritureDto) {
    return this.entriesService.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's écritures." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.entriesService.findAll(company);
  }

  @ApiOperation({ summary: 'Get one écriture by id.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.entriesService.findOne(company, id);
  }

  @ApiOperation({ summary: 'Replace a draft écriture. Rejected once the entry is validated.' })
  @ApiParam({ name: 'id' })
  @Patch(':id')
  update(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: CreateEcritureDto,
  ) {
    return this.entriesService.update(company, id, dto);
  }

  @ApiOperation({ summary: 'Delete a draft écriture. Rejected once the entry is validated.' })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.entriesService.remove(company, id);
  }

  @ApiOperation({
    summary: 'Assign the next sequential EcritureNum and lock the entry (immutable from then on).',
  })
  @ApiParam({ name: 'id' })
  @Post(':id/validate')
  validate(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.entriesService.validate(company, id);
  }

  @ApiOperation({
    summary: 'Post a new draft écriture with debit/credit swapped (contre-passation / extourne).',
  })
  @ApiParam({ name: 'id' })
  @Post(':id/reverse')
  reverse(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.entriesService.reverse(company, id);
  }
}
