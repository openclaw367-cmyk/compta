import { randomUUID } from 'crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ChatEngine, ChatMessage, ChatMessageRole, ChatSession, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CHAT_MODEL_PORT, ChatModelPort } from './chat-model/chat-model.port';
import { ChatModelMessage, ChatModelAvailability } from './chat-model/chat-model.types';
import { ChatOrchestratorService, OrchestratedMessage } from './chat-orchestrator.service';
import { InvoiceExtractionService } from './invoice-extraction.service';

const TITLE_MAX_LENGTH = 60;

/**
 * Session/message persistence, plus the availability check the chat UI
 * degrades on. Local by default: this class is injected `CHAT_MODEL_PORT`
 * without knowing whether that resolves to the local Ollama adapter or a
 * cloud adapter — see CLAUDE.md "AI chatbot cloud tier" for exactly which
 * call sites are allowed to bind a cloud adapter and why the default
 * binding (chat-model.module.ts) never does.
 */
@Injectable()
export class AiChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: ChatOrchestratorService,
    private readonly invoiceExtraction: InvoiceExtractionService,
    @Inject(CHAT_MODEL_PORT) private readonly model: ChatModelPort,
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
   * Persists the user's message, extracts any attached invoice files
   * DETERMINISTICALLY (before the model ever runs — see
   * invoice-extraction.service.ts), runs the tool-calling loop (or, if no
   * local model is reachable, skips straight to a clear degraded-state
   * reply — never lets a raw fetch failure surface), persists every
   * message the turn produced (the extraction trace, assistant text, tool
   * calls, tool results, in order), and returns all of it — including the
   * user's own row — so the frontend can append the whole turn to its
   * message list without a refetch.
   */
  async sendMessage(
    company: CompanyContext,
    sessionId: string,
    content: string,
    files: Express.Multer.File[] = [],
  ): Promise<ChatMessage[]> {
    const session = await this.getSession(company, sessionId);
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
      const filePrelude = await this.extractFilePrelude(files);
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
            // Every message produced in this loop is local today — there is
            // no cloud call path yet (see CLAUDE.md "AI chatbot cloud
            // tier"). This is where a future cloud-routed turn would set
            // ChatEngine.CLOUD + cloudProvider instead.
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
        ...(isFirstMessage ? { title: content.slice(0, TITLE_MAX_LENGTH) } : {}),
      },
    });

    return createdRows;
  }

  /**
   * Deterministic extraction happens HERE — eagerly, before the model
   * turn starts, never as something the model triggers itself. Each
   * file becomes a synthesized assistant-tool-call + tool-result pair
   * (as `extract_invoice_facts`) so it renders through the EXACT SAME
   * trace UI a model-initiated tool call would, with zero new frontend
   * code — see AssistantPage.tsx's generic ToolResultTrace. A file this
   * app can't parse (wrong type, corrupt) becomes a `{ error }` result
   * for that one file, same non-blocking pattern as every other tool
   * failure — it never aborts the whole message.
   */
  private async extractFilePrelude(files: Express.Multer.File[]): Promise<OrchestratedMessage[]> {
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
        const facts = await this.invoiceExtraction.extract(file);
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
