import { NotFoundException } from '@nestjs/common';
import { ChatMessageRole } from '@prisma/client';
import { AiChatService } from './ai-chat.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { LocalModelPort } from './local-model/local-model.port';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { InvoiceExtractionService } from './invoice-extraction.service';

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

function makeInvoiceExtraction() {
  const extract = jest.fn();
  const invoiceExtraction = { extract } as unknown as InvoiceExtractionService;
  return { invoiceExtraction, extract };
}

function makeFile(originalname: string): Express.Multer.File {
  return {
    originalname,
    buffer: Buffer.from('x'),
    mimetype: 'application/pdf',
  } as Express.Multer.File;
}

function buildService(
  overrides: {
    runTurnResolved?: unknown;
    runTurnRejected?: Error;
    available?: boolean;
    availabilityDetail?: string;
  } = {},
) {
  const { prisma, chatSessionFindFirst, chatSessionUpdate } = makePrismaMock();
  const { orchestrator, runTurn } = makeOrchestrator();
  if (overrides.runTurnRejected) {
    runTurn.mockRejectedValue(overrides.runTurnRejected);
  } else {
    runTurn.mockResolvedValue(overrides.runTurnResolved ?? [{ role: 'assistant', content: 'ok' }]);
  }
  const { model } = makeModel(overrides.available ?? true, overrides.availabilityDetail ?? 'ok');
  const { invoiceExtraction, extract } = makeInvoiceExtraction();
  const service = new AiChatService(prisma, orchestrator, invoiceExtraction, model);
  return {
    service,
    prisma,
    chatSessionFindFirst,
    chatSessionUpdate,
    orchestrator,
    runTurn,
    extract,
  };
}

describe('AiChatService', () => {
  it('getSession() throws NotFoundException for a session belonging to another company', async () => {
    const { service, chatSessionFindFirst } = buildService();
    chatSessionFindFirst.mockResolvedValue(null);
    await expect(service.getSession(company, 'session-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sendMessage() persists the user row, the orchestrated turn, and updates the session title on the first message', async () => {
    const { service, chatSessionFindFirst, chatSessionUpdate } = buildService({
      runTurnResolved: [{ role: 'assistant', content: 'Voici la réponse.' }],
    });
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });

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
    const { service, chatSessionFindFirst, chatSessionUpdate } = buildService();
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [{ role: ChatMessageRole.USER, content: 'bonjour' }],
    });

    await service.sendMessage(company, 'session-1', 'et ensuite ?');

    const updateCall = chatSessionUpdate.mock.calls[0][0] as { data: { title?: string } };
    expect(updateCall.data.title).toBeUndefined();
  });

  it('degrades cleanly, without calling the orchestrator, when no local model is available', async () => {
    const { service, chatSessionFindFirst, runTurn } = buildService({
      available: false,
      availabilityDetail: 'Ollama ne répond pas.',
    });
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });

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
    const { service, chatSessionFindFirst } = buildService({
      runTurnRejected: new Error("Le modèle local n'a pas répondu dans le délai de 120000ms."),
    });
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });

    const rows = await service.sendMessage(company, 'session-1', 'question longue');

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ role: ChatMessageRole.ASSISTANT });
    expect((rows[1] as { content: string }).content).toContain("n'a pas répondu dans le délai");
  });

  it("extracts an attached file DETERMINISTICALLY before the model turn, and passes the result as the orchestrator's filePrelude", async () => {
    const { service, chatSessionFindFirst, orchestrator, runTurn, extract } = buildService();
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });
    extract.mockResolvedValue({
      fileName: 'facture.pdf',
      fields: { montantTtc: { value: '120.00', source: 'parsed' } },
      rawText: 'x',
    });

    await service.sendMessage(company, 'session-1', 'traite cette facture', [
      makeFile('facture.pdf'),
    ]);

    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ originalname: 'facture.pdf' }));
    const [, , , filePrelude] = runTurn.mock.calls[0] as [unknown, unknown, unknown, unknown[]];
    expect(filePrelude).toHaveLength(2);
    expect(filePrelude[0]).toMatchObject({
      role: 'assistant',
      toolCalls: [expect.objectContaining({ name: 'extract_invoice_facts' })],
    });
    expect(filePrelude[1]).toMatchObject({ role: 'tool', toolName: 'extract_invoice_facts' });
    expect((filePrelude[1] as { content: string }).content).toContain('120.00');
    void orchestrator;
  });

  it('persists the extraction trace as real ChatMessage rows, even when extraction finds nothing usable', async () => {
    const { service, chatSessionFindFirst, extract } = buildService({
      runTurnResolved: [
        {
          role: 'assistant',
          toolCalls: [{ id: 'x', name: 'extract_invoice_facts', arguments: {} }],
          content: '',
        },
        {
          role: 'tool',
          toolName: 'extract_invoice_facts',
          toolCallId: 'x',
          content: '{"fileName":"f.pdf","fields":{},"rawText":""}',
        },
        { role: 'assistant', content: 'Je ne trouve aucun montant dans ce document.' },
      ],
    });
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });
    extract.mockResolvedValue({ fileName: 'f.pdf', fields: {}, rawText: '' });

    const rows = await service.sendMessage(company, 'session-1', 'traite cette facture', [
      makeFile('f.pdf'),
    ]);

    expect(rows.map((r) => r.role)).toEqual([
      ChatMessageRole.USER,
      ChatMessageRole.ASSISTANT,
      ChatMessageRole.TOOL,
      ChatMessageRole.ASSISTANT,
    ]);
  });

  it('a file that fails to parse (wrong type, corrupt) yields a per-file error result rather than aborting the whole message', async () => {
    const { service, chatSessionFindFirst, extract, runTurn } = buildService();
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });
    extract.mockRejectedValue(new Error('Type de fichier non pris en charge'));

    await service.sendMessage(company, 'session-1', 'traite ce fichier', [makeFile('bad.docx')]);

    // The orchestrator (and, in the real implementation, the persistence
    // loop through its returned `produced`) receives the file prelude as
    // an argument — a per-file extraction failure still produces a
    // tool-result entry (an error, not a crash), it just doesn't abort
    // building the prelude for the rest of the turn.
    const [, , , filePrelude] = runTurn.mock.calls[0] as [unknown, unknown, unknown, unknown[]];
    expect(filePrelude).toHaveLength(2);
    expect(filePrelude[1]).toMatchObject({ role: 'tool', toolName: 'extract_invoice_facts' });
    expect((filePrelude[1] as { content: string }).content).toContain('non pris en charge');
  });

  it('still persists a successful extraction trace even when the model call afterward fails', async () => {
    // The deterministic extraction already succeeded independently of the
    // LLM call — losing it on a model timeout would silently discard real
    // work. See ai-chat.service.ts's own comment at this exact call site.
    const { service, chatSessionFindFirst, extract, runTurn } = buildService({
      runTurnRejected: new Error("Le modèle local n'a pas répondu dans le délai de 120000ms."),
    });
    chatSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      companyId: 'company-1',
      messages: [],
    });
    extract.mockResolvedValue({
      fileName: 'facture.pdf',
      fields: { montantTtc: { value: '120.00', source: 'parsed' } },
      rawText: 'x',
    });

    const rows = await service.sendMessage(company, 'session-1', 'traite cette facture', [
      makeFile('facture.pdf'),
    ]);

    const toolRow = rows.find((r) => r.role === ChatMessageRole.TOOL);
    expect(toolRow?.content).toContain('120.00');
    const lastRow = rows[rows.length - 1];
    expect(lastRow.content).toContain("n'a pas répondu dans le délai");
    void runTurn;
  });
});
