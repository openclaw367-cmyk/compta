import { Module } from '@nestjs/common';
import { InvoiceExtractionService } from './invoice-extraction.service';

/**
 * A single, dependency-free provider (`InvoiceExtractionService` —
 * deterministic PDF/Excel parsing, no I/O beyond reading the buffer it's
 * handed) given its own leaf module so both `AiChatModule` (the assistant's
 * file-prelude) and `DocumentsModule` (the journal-entry attach/prefill
 * flow — see CLAUDE.md "Supporting-document attachments") can import the
 * SAME instance/class rather than either duplicating it or importing one
 * from the other, which would create a circular module dependency
 * (DocumentsModule already needs AiChatModule for ChatOrchestratorService/
 * CloudProposeToolsService). Moved here verbatim from `ai-chat/` — zero
 * logic change, same "single source of truth, not a parallel copy" move
 * already done once for PCG_ACCOUNTS (see `src/common/pcg/`).
 */
@Module({
  providers: [InvoiceExtractionService],
  exports: [InvoiceExtractionService],
})
export class InvoiceExtractionModule {}
