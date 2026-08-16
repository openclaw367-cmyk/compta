import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ChatMessage, ChatMessageRole, ChatSession, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { LOCAL_MODEL_PORT, LocalModelPort } from './local-model/local-model.port';
import { LocalChatMessage, LocalModelAvailability } from './local-model/local-model.types';
import { ChatOrchestratorService, OrchestratedMessage } from './chat-orchestrator.service';

const TITLE_MAX_LENGTH = 60;

/**
 * Session/message persistence, plus the availability check the chat UI
 * degrades on. All local-only: nothing here (or in ChatOrchestratorService,
 * or any tool) ever calls an external network API — see CLAUDE.md
 * "AI chatbot" and LocalModelPort's own doc comment.
 */
@Injectable()
export class AiChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: ChatOrchestratorService,
    @Inject(LOCAL_MODEL_PORT) private readonly model: LocalModelPort,
  ) {}

  availability(): Promise<LocalModelAvailability> {
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
   * Persists the user's message, runs the tool-calling loop (or, if no
   * local model is reachable, skips straight to a clear degraded-state
   * reply — never lets a raw fetch failure surface), persists every
   * message the turn produced (assistant text, tool calls, tool results,
   * in order), and returns all of it — including the user's own row — so
   * the frontend can append the whole turn to its message list without a
   * refetch.
   */
  async sendMessage(
    company: CompanyContext,
    sessionId: string,
    content: string,
  ): Promise<ChatMessage[]> {
    const session = await this.getSession(company, sessionId);
    const isFirstMessage = session.messages.length === 0;

    const userRow = await this.prisma.chatMessage.create({
      data: { companyId: company.companyId, sessionId, role: ChatMessageRole.USER, content },
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
        },
      });
      createdRows.push(row);
    } else {
      const history: LocalChatMessage[] = session.messages.map(toLocalChatMessage);
      // A local model can fail mid-turn (timeout, the daemon dropping
      // connection) on real hardware — observed live during Phase 1
      // verification, not a hypothetical. This must degrade the same
      // clean way as the availability check above, never surface as a
      // raw 500: the failure is in reaching the model, not in anything
      // this app computed, so it's reported the same honest way.
      let produced: OrchestratedMessage[];
      try {
        produced = await this.orchestrator.runTurn(company, history, content);
      } catch (err) {
        produced = [
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
}

function toLocalChatMessage(row: ChatMessage): LocalChatMessage {
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
