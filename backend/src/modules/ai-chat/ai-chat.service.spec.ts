import { NotFoundException } from '@nestjs/common';
import { ChatMessageRole } from '@prisma/client';
import { AiChatService } from './ai-chat.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { LocalModelPort } from './local-model/local-model.port';
import { ChatOrchestratorService } from './chat-orchestrator.service';

const company: CompanyContext = { companyId: 'company-1' };

function makePrismaMock() {
  let nextId = 1;
  const chatMessageCreate = jest.fn((args: { data: Record<string, unknown> }) => ({
    id: `msg-${nextId++}`,
    createdAt: new Date(),
    toolCalls: null,
    toolName: null,
    toolCallId: null,
    ...args.data,
  }));
  const chatSessionFindFirst = jest.fn();
  const chatSessionUpdate = jest.fn();
  const prisma = {
    chatMessage: { create: chatMessageCreate },
    chatSession: { findFirst: chatSessionFindFirst, update: chatSessionUpdate },
  } as unknown as PrismaService;
  // Returned alongside the typed `prisma` object so tests can assert on
  // these directly — asserting via `prisma.chatSession.update` trips
  // @typescript-eslint/unbound-method, since PrismaService's real delegate
  // methods aren't declared `this: void`.
  return { prisma, chatSessionFindFirst, chatSessionUpdate };
}

function makeOrchestrator() {
  const runTurn = jest.fn();
  const orchestrator = { runTurn } as unknown as ChatOrchestratorService;
  return { orchestrator, runTurn };
}

function makeModel(available = true, detail = 'ok') {
  const isAvailable = jest.fn().mockResolvedValue({ available, detail });
  const model = { complete: jest.fn(), isAvailable } as unknown as LocalModelPort;
  return { model, isAvailable };
}

describe('AiChatService', () => {
  it('getSession() throws NotFoundException for a session belonging to another company', async () => {
    const { prisma, chatSessionFindFirst } = makePrismaMock();
    chatSessionFindFirst.mockResolvedValue(null);
    const { orchestrator } = makeOrchestrator();
    const { model } = makeModel();
    const service = new AiChatService(prisma, orchestrator, model);
    await expect(service.getSession(company, 'session-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sendMessage() persists the user row, the orchestrated turn, and updates the session title on the first message', async () => {
    const { prisma, chatSessionFindFirst, chatSessionUpdate } = makePrismaMock();
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });
    const { orchestrator, runTurn } = makeOrchestrator();
    runTurn.mockResolvedValue([{ role: 'assistant', content: 'Voici la réponse.' }]);
    const { model } = makeModel();
    const service = new AiChatService(prisma, orchestrator, model);

    const rows = await service.sendMessage(company, 'session-1', 'Quelle est ma trésorerie ?');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      role: ChatMessageRole.USER,
      content: 'Quelle est ma trésorerie ?',
    });
    expect(rows[1]).toMatchObject({
      role: ChatMessageRole.ASSISTANT,
      content: 'Voici la réponse.',
    });
    expect(chatSessionUpdate).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: expect.objectContaining({ title: 'Quelle est ma trésorerie ?' }),
    });
  });

  it('does not re-title the session on a later message', async () => {
    const { prisma, chatSessionFindFirst, chatSessionUpdate } = makePrismaMock();
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [{ role: ChatMessageRole.USER, content: 'bonjour' }],
    });
    const { orchestrator, runTurn } = makeOrchestrator();
    runTurn.mockResolvedValue([{ role: 'assistant', content: 'ok' }]);
    const { model } = makeModel();
    const service = new AiChatService(prisma, orchestrator, model);

    await service.sendMessage(company, 'session-1', 'et ensuite ?');

    const updateCall = chatSessionUpdate.mock.calls[0][0] as { data: { title?: string } };
    expect(updateCall.data.title).toBeUndefined();
  });

  it('degrades cleanly, without calling the orchestrator, when no local model is available', async () => {
    const { prisma, chatSessionFindFirst } = makePrismaMock();
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });
    const { orchestrator, runTurn } = makeOrchestrator();
    const { model } = makeModel(false, 'Ollama ne répond pas.');
    const service = new AiChatService(prisma, orchestrator, model);

    const rows = await service.sendMessage(company, 'session-1', 'bonjour');

    expect(runTurn).not.toHaveBeenCalled();
    expect(rows[1]).toMatchObject({ role: ChatMessageRole.ASSISTANT });
    expect((rows[1] as { content: string }).content).toContain('Ollama ne répond pas.');
  });

  it('degrades cleanly (never a raw 500) when the orchestrator itself throws mid-turn', async () => {
    // Reproduces a real failure observed live during Phase 1 verification:
    // a local-model timeout mid-conversation threw out of runTurn() and,
    // before this test existed, propagated as an unhandled 500. See
    // ai-chat.service.ts's own comment at the call site.
    const { prisma, chatSessionFindFirst } = makePrismaMock();
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });
    const { orchestrator, runTurn } = makeOrchestrator();
    runTurn.mockRejectedValue(
      new Error("Le modèle local n'a pas répondu dans le délai de 120000ms."),
    );
    const { model } = makeModel();
    const service = new AiChatService(prisma, orchestrator, model);

    const rows = await service.sendMessage(company, 'session-1', 'question longue');

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ role: ChatMessageRole.ASSISTANT });
    expect((rows[1] as { content: string }).content).toContain("n'a pas répondu dans le délai");
  });
});
