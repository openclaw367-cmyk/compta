import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { InvoiceExtractionService } from '../invoice-extraction/invoice-extraction.service';
import { DocumentSuggestionService } from './document-suggestion.service';
import { SuggestAccountsDto } from './dto/suggest-accounts.dto';

/**
 * Stateless, no-persistence entry-creation helpers — see CLAUDE.md
 * "Supporting-document attachments" — Layers 2/3. Neither route here
 * creates or reads an EcritureDocument; both exist so a document can be
 * useful BEFORE an écriture id exists yet (mid-creation, in
 * EcritureEditor). `/documents/extract` never touches company data (pure
 * deterministic parsing) but still sits behind CompanyContextMiddleware
 * for consistency; `/documents/suggest-accounts` genuinely needs it, to
 * resolve this company's own cloud credential.
 */
@ApiTags('documents')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('documents')
export class DocumentExtractionController {
  constructor(
    private readonly invoiceExtraction: InvoiceExtractionService,
    private readonly suggestion: DocumentSuggestionService,
  ) {}

  @ApiOperation({
    summary: 'Deterministic PDF/Excel field extraction — no persistence, no écriture required.',
    description:
      'Reuses InvoiceExtractionService verbatim (see CLAUDE.md) — same anchored label/regex ' +
      'fields, same "found and parsed, or simply absent — never guessed" discipline as the ' +
      "assistant's own extract_invoice_facts. This is what makes attaching a file WHILE " +
      'creating a new draft (before it has an id) work at all.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @Post('extract')
  @UseInterceptors(FileInterceptor('file'))
  extract(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    return this.invoiceExtraction.extract(file);
  }

  @ApiOperation({
    summary: 'The "Comptable IA" toggle\'s explicit action — one cloud turn suggesting accounts.',
    description:
      'Requires a configured cloud credential for the given provider (never local — see ' +
      'CLAUDE.md "Supporting-document attachments" — Layer 3: the earlier local-model benchmark ' +
      "already showed local models can't reliably suggest valid accounts). Reuses " +
      'ChatOrchestratorService.runTurn() + CloudProposeToolsService verbatim — the SAME gate and ' +
      'review discipline propose_ecriture already uses in the assistant, not a parallel, weaker ' +
      'implementation. Stateless: no ChatSession/ChatMessage is created.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        cloudProvider: { type: 'string', enum: ['CLAUDE', 'DEEPSEEK'] },
      },
      required: ['file', 'cloudProvider'],
    },
  })
  @Post('suggest-accounts')
  @UseInterceptors(FileInterceptor('file'))
  suggestAccounts(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: SuggestAccountsDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    return this.suggestion.suggest(company, dto.cloudProvider, file);
  }
}
