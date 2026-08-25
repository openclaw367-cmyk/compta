import { randomUUID } from 'crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChatEngine,
  ChatMessage,
  ChatMessageRole,
  ChatSession,
  CloudModelProvider,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CHAT_MODEL_PORT, ChatModelPort } from './chat-model/chat-model.port';
import { ChatModelMessage, ChatModelAvailability } from './chat-model/chat-model.types';
import { CLOUD_MODEL_NAMES, createCloudModelAdapter } from './chat-model/cloud-model-registry';
import { ChatOrchestratorService, OrchestratedMessage } from './chat-orchestrator.service';
import { InvoiceExtractionService } from '../invoice-extraction/invoice-extraction.service';
import { buildInvoiceExtractionPrelude } from './invoice-extraction-prelude';
import { CloudCredentialsService } from '../cloud-credentials/cloud-credentials.service';
import { CloudProposeToolsService } from './tools/cloud-propose-tools.service';
import { decideCloudThread } from './cloud-thread-gate';

const TITLE_MAX_LENGTH = 60;

const PROVIDER_LABELS: Record<CloudModelProvider, string> = {
  CLAUDE: 'Claude',
  DEEPSEEK: 'DeepSeek',
};

/**
 * Session/message persistence, plus the availability check the chat UI
 * degrades on. Local by default: this class is injected `CHAT_MODEL_PORT`
 * without knowing whether that resolves to the local Ollama adapter or a
 * cloud adapter — see CLAUDE.md "AI chatbot cloud tier" for exactly which
 * call sites are allowed to bind a cloud adapter and why the default
 * binding (chat-model.module.ts) never does. The cloud path itself is
 * `sendCloudMessage()` below — a SEPARATE method from the local
 * `sendMessage()` body, not a branch buried inside shared logic, so the
 * default (local) path is never at risk of accidentally picking up cloud
 * behavior by editing the wrong branch.
 */
@Injectable()
export class AiChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: ChatOrchestratorService,
    private readonly invoiceExtraction: InvoiceExtractionService,
    @Inject(CHAT_MODEL_PORT) private readonly model: ChatModelPort,
    private readonly cloudCredentials: CloudCredentialsService,
    private readonly cloudProposeTools: CloudProposeToolsService,
  ) {}

  availability(): Promise<ChatModelAvailability> {
    return this.model.isAvailable();
  }

  createSession(company: CompanyContext): Promise<ChatSession> {
    return this.prisma.chatSession.create({ data: { companyId: company.companyId } });
  }

  listSessions(company: CompanyContext): Promise<ChatSession[]> {
    return this.prisma.chatSession.findMany({
      where: { companyId: company.companyId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getSession(
    company: CompanyContext,
    id: string,
  ): Promise<ChatSession & { messages: ChatMessage[] }> {
    const session = await this.prisma.chatSession.findFirst({
      where: { id, companyId: company.companyId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) {
      throw new NotFoundException(`Chat session ${id} not found`);
    }
    return session;
  }

  /**
   * Entry point for both the default (local) send and the explicit "☁️
   * Proposer avec [Provider]" action — dispatches on whether `cloudProvider`
   * was supplied (see SendChatMessageDto's own doc comment: presence IS
   * the per-invocation cloud action). The two bodies are separate methods
   * (`sendLocalMessage`/`sendCloudMessage`) rather than one branchy method,
   * so the default path can never accidentally inherit cloud behavior from
   * a shared block — see this class's own doc comment.
   */
  async sendMessage(
    company: CompanyContext,
    sessionId: string,
    content: string,
    files: Express.Multer.File[] = [],
    cloudProvider?: CloudModelProvider,
  ): Promise<ChatMessage[]> {
    const session = await this.getSession(company, sessionId);
    if (cloudProvider) {
      return this.sendCloudMessage(company, session, content, files, cloudProvider);
    }
    return this.sendLocalMessage(company, session, content, files);
  }

  /**
   * Explicit "Revenir au local" action, and the ONLY place besides
   * `sendLocalMessage()`'s own unconditional clear that closes an open
   * cloud-proposal thread — see CLAUDE.md "AI chatbot cloud tier". Callable
   * even when no thread is open (a no-op update in that case); ownership
   * is still checked via `getSession()` so a company can't close another
   * company's session.
   */
  async closeCloudThread(company: CompanyContext, sessionId: string): Promise<ChatSession> {
    await this.getSession(company, sessionId);
    return this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { cloudProposalThreadId: null, cloudProposalProvider: null },
    });
  }

  /**
   * Persists the user's message, extracts any attached invoice files
   * DETERMINISTICALLY (before the model ever runs — see
   * invoice-extraction.service.ts), runs the tool-calling loop (or, if no
   * local model is reachable, skips straight to a clear degraded-state
   * reply — never lets a raw fetch failure surface), persists every
   * message the turn produced (the extraction trace, assistant text, tool
   * calls, tool results, in order), and returns all of it — including the
   * user's own row — so the frontend can append the whole turn to its
   * message list without a refetch.
   *
   * Always clears any open cloud-proposal thread on this session (whether
   * or not one was actually open) — this is the "reverts to local the
   * moment the user sends anything unrelated" half of the granularity
   * design (see CLAUDE.md "AI chatbot cloud tier"): a plain local send is
   * exactly that "anything unrelated" signal, so it's the natural place to
   * enforce the auto-revert without a separate polling/expiry mechanism.
   */
  private async sendLocalMessage(
    company: CompanyContext,
    session: ChatSession & { messages: ChatMessage[] },
    content: string,
    files: Express.Multer.File[],
  ): Promise<ChatMessage[]> {
    const sessionId = session.id;
    const isFirstMessage = session.messages.length === 0;

    const userRow = await this.prisma.chatMessage.create({
      data: {
        companyId: company.companyId,
        sessionId,
        role: ChatMessageRole.USER,
        content,
        engine: ChatEngine.LOCAL,
      },
    });
    const createdRows: ChatMessage[] = [userRow];

    const availability = await this.model.isAvailable();
    if (!availability.available) {
      const row = await this.prisma.chatMessage.create({
        data: {
          companyId: company.companyId,
          sessionId,
          role: ChatMessageRole.ASSISTANT,
          content:
            "Aucun modèle local n'est disponible en ce moment : " +
            `${availability.detail} Aucune donnée comptable n'a quitté cette machine — le ` +
            'message est enregistré, réessayez une fois le modèle local lancé.',
          engine: ChatEngine.LOCAL,
        },
      });
      createdRows.push(row);
    } else {
      const history: ChatModelMessage[] = session.messages.map(toChatModelMessage);
      const filePrelude = await buildInvoiceExtractionPrelude(files, this.invoiceExtraction);
      // A local model can fail mid-turn (timeout, the daemon dropping
      // connection) on real hardware — observed live during Phase 1
      // verification, not a hypothetical. This must degrade the same
      // clean way as the availability check above, never surface as a
      // raw 500: the failure is in reaching the model, not in anything
      // this app computed, so it's reported the same honest way.
      let produced: OrchestratedMessage[];
      try {
        produced = await this.orchestrator.runTurn(company, history, content, filePrelude);
      } catch (err) {
        // filePrelude is kept even on failure: the deterministic extraction
        // already happened and succeeded independently of the model call
        // that failed afterward — losing it would silently discard real
        // work the user is entitled to see, just because the LLM timed out.
        produced = [
          ...filePrelude,
          {
            role: 'assistant',
            content:
              "Le modèle local n'a pas pu terminer sa réponse : " +
              `${err instanceof Error ? err.message : String(err)} Votre message est ` +
              'enregistré — réessayez, ou reformulez plus simplement.',
          },
        ];
      }
      for (const message of produced) {
        const row = await this.prisma.chatMessage.create({
          data: {
            companyId: company.companyId,
            sessionId,
            role: message.role === 'assistant' ? ChatMessageRole.ASSISTANT : ChatMessageRole.TOOL,
            content: message.content,
            toolCalls: message.toolCalls
              ? (message.toolCalls as unknown as Prisma.InputJsonValue)
              : undefined,
            toolName: message.toolName,
            toolCallId: message.toolCallId,
            // Every message produced in THIS method is local — the cloud
            // path is sendCloudMessage() below, a separate method, never a
            // branch here (see this class's own doc comment).
            engine: ChatEngine.LOCAL,
          },
        });
        createdRows.push(row);
      }
    }

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        updatedAt: new Date(),
        // Unconditional — see this method's own doc comment on why a plain
        // local send always closes any open cloud-proposal thread.
        cloudProposalThreadId: null,
        cloudProposalProvider: null,
        ...(isFirstMessage ? { title: content.slice(0, TITLE_MAX_LENGTH) } : {}),
      },
    });

    return createdRows;
  }

  /**
   * The cloud-routed counterpart to `sendLocalMessage()` — reached only
   * when the caller supplied `cloudProvider` (see `sendMessage()`'s own
   * dispatch). Three things happen, in order, BEFORE anything is
   * persisted or any thread state mutated, so a request that was always
   * going to be refused never has a side effect:
   *
   * 1. `CloudCredentialsService.getDecryptedKey()` — throws NotFoundException
   *    if this company never completed the consent flow for `provider`.
   * 2. `decideCloudThread()` (see cloud-thread-gate.ts) — throws
   *    BadRequestException if this turn tries to OPEN a new thread with no
   *    file attached, or tries to continue an open thread with a
   *    different provider than it was opened with.
   *
   * Only once both pass does this method persist the user row, run the
   * orchestrator with a `CloudTurnOverride` (the company's own freshly
   * constructed adapter + that provider's model name + the narrow
   * `CloudProposeToolsService` registry — never the full local
   * read+propose registries), persist every produced message tagged
   * `ChatEngine.CLOUD` + `cloudProvider`, and update the session's
   * `cloudProposalThreadId`/`cloudProposalProvider` to the decided thread
   * — opening it, or simply re-confirming an already-open one.
   *
   * Degrades the same clean way `sendLocalMessage()` does on a mid-turn
   * failure (a provider timeout, a revoked key mid-call) — never a raw
   * 500 — but does NOT touch thread state on that failure: a transient
   * provider error shouldn't silently close a thread the user is still
   * mid-proposal on.
   */
  private async sendCloudMessage(
    company: CompanyContext,
    session: ChatSession & { messages: ChatMessage[] },
    content: string,
    files: Express.Multer.File[],
    provider: CloudModelProvider,
  ): Promise<ChatMessage[]> {
    const sessionId = session.id;
    const isFirstMessage = session.messages.length === 0;

    const apiKey = await this.cloudCredentials.getDecryptedKey(company, provider);
    const decision = decideCloudThread(
      session,
      { provider, hasAttachedFiles: files.length > 0 },
      randomUUID(),
    );

    const userRow = await this.prisma.chatMessage.create({
      data: {
        companyId: company.companyId,
        sessionId,
        role: ChatMessageRole.USER,
        content,
        engine: ChatEngine.CLOUD,
        cloudProvider: provider,
      },
    });
    const createdRows: ChatMessage[] = [userRow];

    const history: ChatModelMessage[] = session.messages.map(toChatModelMessage);
    const filePrelude = await buildInvoiceExtractionPrelude(files, this.invoiceExtraction);
    let produced: OrchestratedMessage[];
    try {
      produced = await this.orchestrator.runTurn(company, history, content, filePrelude, {
        model: createCloudModelAdapter(provider, apiKey),
        modelName: CLOUD_MODEL_NAMES[provider],
        tools: this.cloudProposeTools,
      });
    } catch (err) {
      // Same "keep the deterministic extraction even on a model failure"
      // discipline as sendLocalMessage() — see that method's own comment.
      produced = [
        ...filePrelude,
        {
          role: 'assistant',
          content:
            `Le modèle ${PROVIDER_LABELS[provider]} n'a pas pu terminer sa réponse : ` +
            `${err instanceof Error ? err.message : String(err)} Votre message est enregistré ` +
            '— réessayez, ou revenez au local (« Revenir au local »).',
        },
      ];
    }

    for (const message of produced) {
      const row = await this.prisma.chatMessage.create({
        data: {
          companyId: company.companyId,
          sessionId,
          role: message.role === 'assistant' ? ChatMessageRole.ASSISTANT : ChatMessageRole.TOOL,
          content: message.content,
          toolCalls: message.toolCalls
            ? (message.toolCalls as unknown as Prisma.InputJsonValue)
            : undefined,
          toolName: message.toolName,
          toolCallId: message.toolCallId,
          engine: ChatEngine.CLOUD,
          cloudProvider: provider,
        },
      });
      createdRows.push(row);
    }

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        updatedAt: new Date(),
        cloudProposalThreadId: decision.threadId,
        cloudProposalProvider: provider,
        ...(isFirstMessage ? { title: content.slice(0, TITLE_MAX_LENGTH) } : {}),
      },
    });

    return createdRows;
  }
}

function toChatModelMessage(row: ChatMessage): ChatModelMessage {
  return {
    role:
      row.role === ChatMessageRole.USER
        ? 'user'
        : row.role === ChatMessageRole.TOOL
          ? 'tool'
          : 'assistant',
    content: row.content,
    toolCalls: row.toolCalls
      ? (row.toolCalls as unknown as {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        }[])
      : undefined,
    toolCallId: row.toolCallId ?? undefined,
    toolName: row.toolName ?? undefined,
  };
}
