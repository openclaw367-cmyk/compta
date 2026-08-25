import { Injectable } from '@nestjs/common';
import { CloudModelProvider } from '@prisma/client';
import { CompanyContext } from '../../common/tenant/company-context';
import { CloudCredentialsService } from '../cloud-credentials/cloud-credentials.service';
import { ChatOrchestratorService, OrchestratedMessage } from '../ai-chat/chat-orchestrator.service';
import { CloudProposeToolsService } from '../ai-chat/tools/cloud-propose-tools.service';
import {
  CLOUD_MODEL_NAMES,
  createCloudModelAdapter,
} from '../ai-chat/chat-model/cloud-model-registry';
import { buildInvoiceExtractionPrelude } from '../ai-chat/invoice-extraction-prelude';
import { ProposedEcriture } from '../ai-chat/tools/propose-tools.service';
import { InvoiceExtractionService } from '../invoice-extraction/invoice-extraction.service';

export interface DocumentAccountSuggestion {
  /** A confirmable propose_ecriture proposal, or null if the model didn't produce one. */
  proposal: ProposedEcriture | null;
  /** The model's own text — shown when there's no proposal (it's asking for more info, refusing, etc.). */
  message: string | null;
}

const SUGGESTION_INSTRUCTION =
  "Une facture a été jointe lors de la création d'une nouvelle écriture. À partir des " +
  'informations extraites ci-dessous, propose les comptes, montants et taux de TVA ' +
  "appropriés pour cette écriture via l'outil propose_ecriture. N'invente aucun " +
  'identifiant : résous chaque référence (compte, taux de TVA) via les outils de recherche.';

/**
 * The backend for the journal-entry "Comptable IA" toggle (see CLAUDE.md
 * "Supporting-document attachments — Part 3") — a genuine reuse of the
 * assistant's own cloud-suggestion machinery, not a parallel
 * implementation with a weaker review discipline. Same gate
 * (`CloudCredentialsService.getDecryptedKey()` — throws if the requested
 * provider isn't configured), same narrow tool registry
 * (`CloudProposeToolsService` — search_accounts/list_vat_rates/
 * propose_ecriture, never the full 16-tool read registry), same
 * `propose_ecriture` review discipline (returns a `ProposedEcriture` a
 * human must confirm — never persists anything itself).
 *
 * Deliberately stateless: no ChatSession/ChatMessage is created or read.
 * `ChatOrchestratorService.runTurn()` is already a pure function —
 * `history` is passed in explicitly, nothing is read from a persisted
 * session — so calling it here with `history: []` for one genuine
 * one-shot turn is a legitimate, already-supported use, not a
 * workaround. `decideCloudThread()`'s multi-turn thread-continuation
 * rules (open/continue/switch-refused/revert) are NOT reused here on
 * purpose: those bound a conversational thread in the Assistant UI, and
 * a one-shot suggestion isn't a conversation.
 */
@Injectable()
export class DocumentSuggestionService {
  constructor(
    private readonly invoiceExtraction: InvoiceExtractionService,
    private readonly orchestrator: ChatOrchestratorService,
    private readonly cloudProposeTools: CloudProposeToolsService,
    private readonly cloudCredentials: CloudCredentialsService,
  ) {}

  async suggest(
    company: CompanyContext,
    provider: CloudModelProvider,
    file: Express.Multer.File,
  ): Promise<DocumentAccountSuggestion> {
    const apiKey = await this.cloudCredentials.getDecryptedKey(company, provider);
    const filePrelude = await buildInvoiceExtractionPrelude([file], this.invoiceExtraction);
    const produced = await this.orchestrator.runTurn(
      company,
      [],
      SUGGESTION_INSTRUCTION,
      filePrelude,
      {
        model: createCloudModelAdapter(provider, apiKey),
        modelName: CLOUD_MODEL_NAMES[provider],
        tools: this.cloudProposeTools,
      },
    );
    return extractSuggestion(produced);
  }
}

function isProposedEcriture(value: unknown): value is ProposedEcriture {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dto' in value &&
    'warnings' in value &&
    'assumptions' in value
  );
}

function extractSuggestion(produced: OrchestratedMessage[]): DocumentAccountSuggestion {
  const lastProposal = [...produced]
    .reverse()
    .find((m) => m.role === 'tool' && m.toolName === 'propose_ecriture');
  if (lastProposal) {
    try {
      const parsed: unknown = JSON.parse(lastProposal.content);
      if (isProposedEcriture(parsed)) {
        return { proposal: parsed, message: null };
      }
    } catch {
      // Not valid JSON, or a rejected proposal's `{ error }` shape — fall
      // through to the assistant's own text below rather than surfacing
      // a parse error, same "no proposal, show the message" outcome.
    }
  }
  const lastAssistant = [...produced].reverse().find((m) => m.role === 'assistant' && m.content);
  return { proposal: null, message: lastAssistant?.content ?? null };
}
