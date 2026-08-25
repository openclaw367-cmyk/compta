import { Module } from '@nestjs/common';
import { InvoiceExtractionModule } from '../invoice-extraction/invoice-extraction.module';
import { AiChatModule } from '../ai-chat/ai-chat.module';
import { CloudCredentialsModule } from '../cloud-credentials/cloud-credentials.module';
import { EcritureDocumentsController } from './ecriture-documents.controller';
import { EcritureDocumentsService } from './ecriture-documents.service';
import { DocumentExtractionController } from './document-extraction.controller';
import { DocumentSuggestionService } from './document-suggestion.service';

/**
 * Attach/view/prefill/suggest for écriture supporting documents — see
 * CLAUDE.md "Supporting-document attachments". `AiChatModule` is imported
 * for its two exported providers (`ChatOrchestratorService`,
 * `CloudProposeToolsService`) that `DocumentSuggestionService` reuses
 * verbatim for the "Comptable IA" toggle — never a parallel
 * implementation. `InvoiceExtractionModule` supplies the same
 * deterministic extraction the assistant uses. No circular dependency:
 * `AiChatModule` itself imports `InvoiceExtractionModule` too, but never
 * this module.
 */
@Module({
  imports: [InvoiceExtractionModule, AiChatModule, CloudCredentialsModule],
  controllers: [EcritureDocumentsController, DocumentExtractionController],
  providers: [EcritureDocumentsService, DocumentSuggestionService],
})
export class DocumentsModule {}
