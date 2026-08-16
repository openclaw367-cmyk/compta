import { ConfigService } from '@nestjs/config';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { LocalCompletionRequest, LocalCompletionResult } from './local-model/local-model.types';

const company: CompanyContext = { companyId: 'company-1' };

type ToolOutcome = { ok: true; value: unknown } | { ok: false; error: string };

function buildOrchestrator(modelResponses: LocalCompletionResult[]) {
  let call = 0;
  // Deliberately NOT typed as jest.Mocked<LocalModelPort> — that trips
  // @typescript-eslint/unbound-method on every `expect(model.complete)...`
  // below, since the interface declares `complete` as a regular method.
  // A plain object literal with jest.fn() properties sidesteps that
  // without weakening what's actually asserted.
  const model = {
    complete: jest.fn((request: LocalCompletionRequest) => {
      void request;
      return Promise.resolve(modelResponses[Math.min(call++, modelResponses.length - 1)]);
    }),
    isAvailable: jest.fn(),
  };
  const toolSpec = { name: 'query_trial_balance', description: 'x', parameters: {} };
  const readTools = {
    getAll: jest.fn(() => [{ spec: toolSpec, execute: jest.fn() }]),
    execute: jest.fn((): Promise<ToolOutcome> =>
      Promise.resolve({ ok: true, value: { balance: '100.00' } }),
    ),
  };
  const chatContext = { buildContext: jest.fn(() => Promise.resolve('(contexte résolu)')) };
  const config = { get: jest.fn(() => 'qwen2.5:7b') } as unknown as ConfigService;
  const orchestrator = new ChatOrchestratorService(
    model,
    readTools as never,
    chatContext as never,
    config,
  );
  return { orchestrator, model, readTools, chatContext };
}

describe('ChatOrchestratorService', () => {
  it('returns a single assistant message when the model answers with no tool calls', async () => {
    const { orchestrator, model } = buildOrchestrator([
      { content: 'Votre trésorerie est de 100,00 €.', toolCalls: [] },
    ]);
    const produced = await orchestrator.runTurn(company, [], 'quelle est ma trésorerie ?');
    expect(model.complete).toHaveBeenCalledTimes(1);
    expect(produced).toEqual([{ role: 'assistant', content: 'Votre trésorerie est de 100,00 €.' }]);
  });

  it('runs a tool call, feeds the result back, and returns the full trace in order', async () => {
    const { orchestrator, readTools } = buildOrchestrator([
      {
        content: '',
        toolCalls: [
          { id: 'call-1', name: 'query_trial_balance', arguments: { fiscalYearId: 'fy-1' } },
        ],
      },
      { content: 'Le solde du compte 512000 est de 100,00 €.', toolCalls: [] },
    ]);
    const produced = await orchestrator.runTurn(company, [], 'balance du 512000 ?');

    expect(readTools.execute).toHaveBeenCalledWith(company, 'query_trial_balance', {
      fiscalYearId: 'fy-1',
    });
    expect(produced).toEqual([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call-1', name: 'query_trial_balance', arguments: { fiscalYearId: 'fy-1' } },
        ],
      },
      {
        role: 'tool',
        content: JSON.stringify({ balance: '100.00' }),
        toolName: 'query_trial_balance',
        toolCallId: 'call-1',
      },
      { role: 'assistant', content: 'Le solde du compte 512000 est de 100,00 €.' },
    ]);
  });

  it('feeds a failed tool call back as a structured error rather than throwing', async () => {
    const { orchestrator, readTools } = buildOrchestrator([
      {
        content: '',
        toolCalls: [{ id: 'call-1', name: 'query_trial_balance', arguments: {} }],
      },
      { content: "Je n'ai pas pu trouver cet exercice.", toolCalls: [] },
    ]);
    readTools.execute.mockResolvedValueOnce({ ok: false, error: 'fiscalYearId is required' });

    const produced = await orchestrator.runTurn(company, [], 'balance ?');
    expect(produced[1]).toEqual({
      role: 'tool',
      content: JSON.stringify({ error: 'fiscalYearId is required' }),
      toolName: 'query_trial_balance',
      toolCallId: 'call-1',
    });
  });

  it('stops after the iteration cap and returns an honest fallback rather than looping forever', async () => {
    const alwaysCallsTool: LocalCompletionResult = {
      content: '',
      toolCalls: [
        { id: 'call-x', name: 'query_trial_balance', arguments: { fiscalYearId: 'fy-1' } },
      ],
    };
    const { orchestrator, model } = buildOrchestrator([alwaysCallsTool]);

    const produced = await orchestrator.runTurn(company, [], 'boucle ?');

    // 6 iterations, each contributing an assistant-with-toolCalls + a tool-result message
    expect(model.complete).toHaveBeenCalledTimes(6);
    const last = produced[produced.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toMatch(/pas réussi à répondre/);
  });

  it('prepends conversation history before the new user message', async () => {
    const { orchestrator, model } = buildOrchestrator([{ content: 'ok', toolCalls: [] }]);
    await orchestrator.runTurn(
      company,
      [
        { role: 'user', content: 'bonjour' },
        { role: 'assistant', content: 'bonjour !' },
      ],
      'et maintenant ?',
    );
    const sentMessages = model.complete.mock.calls[0][0].messages;
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages.slice(1)).toEqual([
      { role: 'user', content: 'bonjour' },
      { role: 'assistant', content: 'bonjour !' },
      { role: 'user', content: 'et maintenant ?' },
    ]);
  });

  it('fetches and appends the resolved reference context (fiscal years/journals with real ids) to the system message every turn', async () => {
    const { orchestrator, model, chatContext } = buildOrchestrator([
      { content: 'ok', toolCalls: [] },
    ]);
    await orchestrator.runTurn(company, [], 'une question');

    expect(chatContext.buildContext).toHaveBeenCalledWith(company);
    const sentMessages = model.complete.mock.calls[0][0].messages;
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages[0].content).toContain('(contexte résolu)');
  });
});
