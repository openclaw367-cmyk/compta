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
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { EntriesService } from './entries.service';
import { CreateEcritureDto } from './dto/create-ecriture.dto';
import { SetLettrageDto } from './dto/set-lettrage.dto';

@ApiTags('entries')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description:
    'Tenant id — must name a company the caller (see Authorization header) is a member of.',
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

  @ApiOperation({
    summary:
      'Search écritures by libellé/PieceRef substring or exact amount/PieceRef — powers the ' +
      'command palette.',
    description:
      'A bare number (comma or point decimal) is treated as an exact debit/credit amount OR a ' +
      'PieceRef substring match (a piece reference is often itself a bare number); anything ' +
      'else is a case-insensitive libellé OR PieceRef substring match. Must come before the ' +
      ':id route below or "search" would be parsed as an id.',
  })
  @ApiQuery({ name: 'q', required: true })
  @Get('search')
  search(@CurrentCompany() company: CompanyContext, @Query('q') q?: string) {
    return this.entriesService.search(company, q ?? '');
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

  @ApiOperation({
    summary: 'Set or clear lettrage/dateLettrage on one line — allowed on a validated line too.',
    description:
      'The one write path that bypasses the validated-écriture immutability rule, deliberately — ' +
      'see CLAUDE.md "Bank reconciliation": lettrage is reconciliation metadata, not part of an ' +
      "entry's balance/compliance content. Omit lettrage (or send null) to clear it. A validated " +
      "line's change is logged (LettrageAuditLog); a draft line's is not, same as before.",
  })
  @ApiParam({ name: 'id' })
  @Patch('lignes/:id/lettrage')
  setLettrage(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: SetLettrageDto,
  ) {
    return this.entriesService.setLettrage(company, id, dto.lettrage ?? null);
  }
}
