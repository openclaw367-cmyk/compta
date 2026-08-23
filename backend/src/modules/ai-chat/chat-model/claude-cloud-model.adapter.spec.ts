import Anthropic from '@anthropic-ai/sdk';
import { ClaudeCloudModelAdapter } from './claude-cloud-model.adapter';
import { ChatModelMessage } from './chat-model.types';

function buildAdapter() {
  const adapter = new ClaudeCloudModelAdapter('sk-ant-test-key');
  const client = (adapter as unknown as { client: Anthropic }).client;
  return { adapter, client };
}

function textMessage(text: string): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text, citations: [] }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1, output_tokens: 1 } as unknown as Anthropic.Usage,
  } as unknown as Anthropic.Message;
}

describe('ClaudeCloudModelAdapter', () => {
  it('pins the host to api.anthropic.com regardless of any ambient base URL', () => {
    const { client } = buildAdapter();
    expect(client.baseURL).toBe('https://api.anthropic.com');
  });

  it('translates system/user/assistant messages and always requests adaptive thinking', async () => {
    const { adapter, client } = buildAdapter();
    const createSpy = jest
      .spyOn(client.messages, 'create')
      .mockResolvedValue(textMessage('Voici la réponse.'));

    const history: ChatModelMessage[] = [
      { role: 'system', content: 'Tu es un assistant.' },
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Salut !' },
    ];

    const result = await adapter.complete({
      model: 'claude-opus-5',
      messages: history,
      tools: [],
    });

    expect(result).toEqual({ content: 'Voici la réponse.', toolCalls: [] });
    const call = createSpy.mock.calls[0][0];
    expect(call.model).toBe('claude-opus-5');
    expect(call.system).toBe('Tu es un assistant.');
    expect(call.thinking).toEqual({ type: 'adaptive' });
    expect(call.messages).toEqual([
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: [{ type: 'text', text: 'Salut !' }] },
    ]);
  });

  it('translates an assistant tool call and merges consecutive tool results into one user turn', async () => {
    const { adapter, client } = buildAdapter();
    const createSpy = jest
      .spyOn(client.messages, 'create')
      .mockResolvedValue(textMessage('Terminé.'));

    const history: ChatModelMessage[] = [
      { role: 'user', content: 'balance ?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call-1', name: 'query_trial_balance', arguments: { fiscalYearId: 'fy-1' } },
          { id: 'call-2', name: 'list_journals', arguments: {} },
        ],
      },
      {
        role: 'tool',
        content: '{"balance":"100.00"}',
        toolName: 'query_trial_balance',
        toolCallId: 'call-1',
      },
      { role: 'tool', content: '[]', toolName: 'list_journals', toolCallId: 'call-2' },
    ];

    await adapter.complete({ model: 'claude-opus-5', messages: history, tools: [] });

    const call = createSpy.mock.calls[0][0];
    expect(call.messages).toEqual([
      { role: 'user', content: 'balance ?' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'query_trial_balance',
            input: { fiscalYearId: 'fy-1' },
          },
          { type: 'tool_use', id: 'call-2', name: 'list_journals', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-1', content: '{"balance":"100.00"}' },
          { type: 'tool_result', tool_use_id: 'call-2', content: '[]' },
        ],
      },
    ]);
  });

  it('translates tool specs to Claude input_schema shape', async () => {
    const { adapter, client } = buildAdapter();
    const createSpy = jest.spyOn(client.messages, 'create').mockResolvedValue(textMessage('ok'));

    await adapter.complete({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          name: 'search_accounts',
          description: 'Search accounts',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
    });

    const call = createSpy.mock.calls[0][0];
    expect(call.tools).toEqual([
      {
        name: 'search_accounts',
        description: 'Search accounts',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ]);
  });

  it('omits tools entirely when none are supplied', async () => {
    const { adapter, client } = buildAdapter();
    const createSpy = jest.spyOn(client.messages, 'create').mockResolvedValue(textMessage('ok'));

    await adapter.complete({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });

    expect(createSpy.mock.calls[0][0].tools).toBeUndefined();
  });

  it('parses a tool_use response into a ChatModelToolCall', async () => {
    const { adapter, client } = buildAdapter();
    jest.spyOn(client.messages, 'create').mockResolvedValue({
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'propose_ecriture', input: { libelle: 'x' } },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      stop_details: null,
      usage: {} as unknown as Anthropic.Usage,
    } as unknown as Anthropic.Message);

    const result = await adapter.complete({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'propose' }],
      tools: [],
    });

    expect(result).toEqual({
      content: '',
      toolCalls: [{ id: 'toolu_1', name: 'propose_ecriture', arguments: { libelle: 'x' } }],
    });
  });

  it('degrades a refusal to a clear French assistant message rather than an empty/crashing result', async () => {
    const { adapter, client } = buildAdapter();
    jest.spyOn(client.messages, 'create').mockResolvedValue({
      id: 'msg_3',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [],
      stop_reason: 'refusal',
      stop_sequence: null,
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      usage: {} as unknown as Anthropic.Usage,
    } as unknown as Anthropic.Message);

    const result = await adapter.complete({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.content).toContain('refusé');
    expect(result.content).toContain('cyber');
  });

  it('wraps an authentication error with a clear, named message', async () => {
    const { adapter, client } = buildAdapter();
    const authError = Anthropic.APIError.generate(
      401,
      { error: { type: 'authentication_error' } },
      'invalid x-api-key',
      new Headers(),
    );
    jest.spyOn(client.messages, 'create').mockRejectedValue(authError);

    await expect(
      adapter.complete({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'x' }],
        tools: [],
      }),
    ).rejects.toThrow(/clé API invalide ou révoquée/);
  });

  it('wraps a rate-limit error with a clear, named message', async () => {
    const { adapter, client } = buildAdapter();
    const rateLimitError = Anthropic.APIError.generate(
      429,
      { error: { type: 'rate_limit_error' } },
      'too many requests',
      new Headers(),
    );
    jest.spyOn(client.messages, 'create').mockRejectedValue(rateLimitError);

    await expect(
      adapter.complete({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'x' }],
        tools: [],
      }),
    ).rejects.toThrow(/limite de débit Claude atteinte/);
  });

  it('wraps a connection error with a clear, named message', async () => {
    const { adapter, client } = buildAdapter();
    const connectionError = new Anthropic.APIConnectionError({ message: 'network down' });
    jest.spyOn(client.messages, 'create').mockRejectedValue(connectionError);

    await expect(
      adapter.complete({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'x' }],
        tools: [],
      }),
    ).rejects.toThrow(/connexion à api\.anthropic\.com impossible/);
  });

  it('isAvailable() reports available on a successful models.list() call, without spending a completion', async () => {
    const { adapter, client } = buildAdapter();
    const listSpy = jest.spyOn(client.models, 'list').mockResolvedValue({} as never);
    const createSpy = jest.spyOn(client.messages, 'create');

    const availability = await adapter.isAvailable();

    expect(availability.available).toBe(true);
    expect(listSpy).toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('isAvailable() degrades cleanly (never throws) when the key is invalid', async () => {
    const { adapter, client } = buildAdapter();
    const authError = Anthropic.APIError.generate(
      401,
      { error: { type: 'authentication_error' } },
      'invalid x-api-key',
      new Headers(),
    );
    jest.spyOn(client.models, 'list').mockRejectedValue(authError);

    const availability = await adapter.isAvailable();

    expect(availability.available).toBe(false);
    expect(availability.detail).toContain('clé API invalide ou révoquée');
  });
});
