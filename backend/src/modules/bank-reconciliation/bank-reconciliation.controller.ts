import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { BankStatementImportService } from './bank-statement-import.service';
import { BankReconciliationService } from './bank-reconciliation.service';
import { ImportStatementDto } from './dto/import-statement.dto';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { IgnoreStatementLineDto } from './dto/ignore-statement-line.dto';
import { CreateEcritureDto } from '../entries/dto/create-ecriture.dto';

const UPLOAD_BODY_SCHEMA = {
  schema: {
    type: 'object',
    properties: {
      file: { type: 'string', format: 'binary' },
      bankAccountId: { type: 'string' },
    },
    required: ['file', 'bankAccountId'],
  },
};

/**
 * Statement import (preview-then-confirm, CAMT.053 only in v1) +
 * reconciliation review (propose/confirm/clear/ignore/create-écriture)
 * — see CLAUDE.md "Bank reconciliation". Nothing here auto-posts or
 * auto-reconciles: every match is proposed by GET .../proposals
 * (recomputed fresh, never persisted) and confirmed by an explicit,
 * separate call.
 */
@ApiTags('bank-reconciliation')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('bank-reconciliation')
export class BankReconciliationController {
  constructor(
    private readonly importService: BankStatementImportService,
    private readonly reconciliation: BankReconciliationService,
  ) {}

  @ApiOperation({ summary: 'Parse a CAMT.053 statement — no persistence.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @Post('statements/preview')
  @UseInterceptors(FileInterceptor('file'))
  async preview(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: ImportStatementDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.importService.preview(company, dto.bankAccountId, file.buffer.toString('utf-8'));
  }

  @ApiOperation({ summary: 'Re-parse and persist a CAMT.053 statement (all-or-nothing).' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @Post('statements')
  @UseInterceptors(FileInterceptor('file'))
  async confirmImport(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: ImportStatementDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.importService.confirmImport(
      company,
      dto.bankAccountId,
      file.originalname,
      file.buffer.toString('utf-8'),
    );
  }

  @ApiOperation({ summary: "All of a bank account's statement lines (any status)." })
  @ApiParam({ name: 'bankAccountId' })
  @Get('accounts/:bankAccountId/statement-lines')
  listStatementLines(
    @CurrentCompany() company: CompanyContext,
    @Param('bankAccountId') bankAccountId: string,
  ) {
    return this.reconciliation.listStatementLines(company, bankAccountId);
  }

  @ApiOperation({
    summary: "Ranked match proposals for a bank account's unmatched statement lines.",
    description:
      'Recomputed fresh every call — nothing here is persisted (see matching-engine.ts).',
  })
  @ApiParam({ name: 'bankAccountId' })
  @Get('accounts/:bankAccountId/proposals')
  getProposals(
    @CurrentCompany() company: CompanyContext,
    @Param('bankAccountId') bankAccountId: string,
  ) {
    return this.reconciliation.getProposals(company, bankAccountId);
  }

  @ApiOperation({ summary: 'Confirm a match — sets lettrage on the chosen écriture line.' })
  @ApiParam({ name: 'id' })
  @Post('statement-lines/:id/confirm-match')
  confirmMatch(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: ConfirmMatchDto,
  ) {
    return this.reconciliation.confirmMatch(company, id, dto.ecritureLigneId);
  }

  @ApiOperation({ summary: 'Undo a confirmed match — clears lettrage, reverts to unmatched.' })
  @ApiParam({ name: 'id' })
  @Post('statement-lines/:id/clear-match')
  clearMatch(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.reconciliation.clearMatch(company, id);
  }

  @ApiOperation({ summary: 'Mark a statement line as consciously not needing a match.' })
  @ApiParam({ name: 'id' })
  @Post('statement-lines/:id/ignore')
  ignore(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: IgnoreStatementLineDto,
  ) {
    return this.reconciliation.ignore(company, id, dto.reason);
  }

  @ApiOperation({
    summary:
      'Create a new écriture from an unmatched statement line, through the ordinary create path.',
    description:
      'Calls EntriesService.create() — no privileged write path — then auto-confirms the match ' +
      "against whichever of the new écriture's own lines posted to this bank account.",
  })
  @ApiParam({ name: 'id' })
  @Post('statement-lines/:id/create-ecriture')
  createEcriture(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: CreateEcritureDto,
  ) {
    return this.reconciliation.createEcritureFromLine(company, id, dto);
  }
}
