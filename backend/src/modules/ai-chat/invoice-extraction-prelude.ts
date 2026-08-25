import { randomUUID } from 'crypto';
import { InvoiceExtractionService } from '../invoice-extraction/invoice-extraction.service';
import { OrchestratedMessage } from './chat-orchestrator.service';

/**
 * Builds the `extract_invoice_facts` assistant-tool-call + tool-result
 * pair for each attached file — the shared shape both `AiChatService`
 * (the assistant's own file-attach turn) and `DocumentsModule`'s
 * "Comptable IA" account-suggestion turn feed into
 * `ChatOrchestratorService.runTurn()`'s `filePrelude` parameter, so the
 * model sees the SAME "here's what I attached" → "here's what was found"
 * trace shape in both call sites. Extracted verbatim out of
 * `AiChatService`'s own former private `extractFilePrelude()` — no logic
 * change — specifically so it has exactly one owner rather than a second
 * hand-rolled copy. Deterministic extraction itself (never guessed) is
 * `InvoiceExtractionService`'s own job; a file this app can't parse
 * becomes a `{ error }` tool result for that one file, same non-blocking
 * pattern as every other tool failure — it never aborts the whole turn.
 */
export async function buildInvoiceExtractionPrelude(
  files: Express.Multer.File[],
  invoiceExtraction: InvoiceExtractionService,
): Promise<OrchestratedMessage[]> {
  const prelude: OrchestratedMessage[] = [];
  for (const file of files) {
    const callId = `extract-${randomUUID()}`;
    prelude.push({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: callId, name: 'extract_invoice_facts', arguments: { fileName: file.originalname } },
      ],
    });
    let resultContent: string;
    try {
      const facts = await invoiceExtraction.extract(file);
      resultContent = JSON.stringify(facts);
    } catch (err) {
      resultContent = JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      });
    }
    prelude.push({
      role: 'tool',
      content: resultContent,
      toolName: 'extract_invoice_facts',
      toolCallId: callId,
    });
  }
  return prelude;
}
