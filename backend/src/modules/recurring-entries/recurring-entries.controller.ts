import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { RecurringEntriesService } from './recurring-entries.service';
import { CreateRecurringEntryTemplateDto } from './dto/create-recurring-entry-template.dto';
import { PreviewRecurringEntryTemplateDto } from './dto/preview-recurring-entry-template.dto';

@ApiTags('recurring-entries')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description: 'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('recurring-entries/templates')
export class RecurringEntriesController {
  constructor(private readonly recurringEntries: RecurringEntriesService) {}

  @ApiOperation({ summary: 'Create a recurring entry template.' })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateRecurringEntryTemplateDto) {
    return this.recurringEntries.create(company, dto);
  }

  @ApiOperation({
    summary: "List the company's recurring entry templates, with a computed nextDueDate.",
  })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.recurringEntries.findAll(company);
  }

  @ApiOperation({ summary: 'Full replace of a template (name/journal/libellé/frequency/lines).' })
  @ApiParam({ name: 'id' })
  @Put(':id')
  update(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: CreateRecurringEntryTemplateDto,
  ) {
    return this.recurringEntries.update(company, id, dto);
  }

  @ApiOperation({
    summary: 'Delete a template. A template is pure metadata — this is a real hard delete.',
  })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.recurringEntries.remove(company, id);
  }

  @ApiOperation({
    summary:
      'Preview applying a template for a given date — resolves accounts/journal/fiscal ' +
      'year and validates, but NEVER persists an écriture. Save the returned dto via the ' +
      'ordinary POST /entries.',
    description:
      'Throws (NotFoundException/BadRequestException) exactly like a manual entry would when ' +
      'the date falls outside any fiscal year, or when a stored account number/tiers no longer ' +
      'resolves to a real account.',
  })
  @ApiParam({ name: 'id' })
  @Post(':id/preview')
  preview(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: PreviewRecurringEntryTemplateDto,
  ) {
    return this.recurringEntries.previewApplication(company, id, dto.applicationDate);
  }

  @ApiOperation({
    summary: 'Stamp lastAppliedAt — call right after the écriture built from the preview is saved.',
    description:
      'Purely a "next due" reminder input, not an audit trail — no link to which écriture ' +
      'resulted is kept.',
  })
  @ApiParam({ name: 'id' })
  @Post(':id/mark-applied')
  markApplied(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.recurringEntries.markApplied(company, id);
  }
}
