import OpenAI from 'openai';
import { DeepSeekCloudModelAdapter } from './deepseek-cloud-model.adapter';
import { ChatModelMessage } from './chat-model.types';

function buildAdapter() {
  const adapter = new DeepSeekCloudModelAdapter('sk-deepseek-test-key');
  const client = (adapter as unknown as { client: OpenAI }).client;
  return { adapter, client };
}

function textCompletion(content: string): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'chatcmpl_1',
    object: 'chat.completion',
    created: 0,
    model: 'deepseek-v4-pro',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, refusal: null },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

describe('DeepSeekCloudModelAdapter', () => {
  it('pins the host to api.deepseek.com regardless of any ambient base URL', () => {
    const { client } = buildAdapter();
    expect(client.baseURL).toBe('https://api.deepseek.com');
  });

  it('translates system/user/assistant messages and passes max_tokens', async () => {
    const { adapter, client } = buildAdapter();
    const createSpy = jest
      .spyOn(client.chat.completions, 'create')
      .mockResolvedValue(textCompletion('Voici la réponse.'));

    const history: ChatModelMessage[] = [
      { role: 'system', content: 'Tu es un assistant.' },
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Salut !' },
    ];

    const result = await adapter.complete({
      model: 'deepseek-v4-pro',
      messages: history,
      tools: [],
    });

    expect(result).toEqual({ content: 'Voici la réponse.', toolCalls: [] });
    const call = createSpy.mock.calls[0][0];
    expect(call.model).toBe('deepseek-v4-pro');
    expect(call.max_tokens).toBe(8000);
    expect(call.messages).toEqual([
      { role: 'system', content: 'Tu es un assistant.' },
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Salut !', tool_calls: undefined },
    ]);
  });

  it('translates an assistant tool call and each tool result as its own standalone message', async () => {
    const { adapter, client } = buildAdapter();
    const createSpy = jest
      .spyOn(client.chat.completions, 'create')
      .mockResolvedValue(textCompletion('Terminé.'));

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

    await adapter.complete({ model: 'deepseek-v4-pro', messages: history, tools: [] });

    const call = createSpy.mock.calls[0][0];
    expect(call.messages).toEqual([
      { role: 'user', content: 'balance ?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'query_trial_balance', arguments: '{"fiscalYearId":"fy-1"}' },
          },
          { id: 'call-2', type: 'function', function: { name: 'list_journals', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: '{"balance":"100.00"}', tool_call_id: 'call-1' },
      { role: 'tool', content: '[]', tool_call_id: 'call-2' },
    ]);
  });

  it('translates tool specs to the OpenAI-shaped function tool format', async () => {
    const { adapter, client } = buildAdapter();
    const createSpy = jest
      .spyOn(client.chat.completions, 'create')
      .mockResolvedValue(textCompletion('ok'));

    await adapter.complete({
      model: 'deepseek-v4-pro',
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
        type: 'function',
        function: {
          name: 'search_accounts',
          description: 'Search accounts',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      },
    ]);
  });

  it('omits tools entirely when none are supplied', async () => {
    const { adapter, client } = buildAdapter();
    const createSpy = jest
      .spyOn(client.chat.completions, 'create')
      .mockResolvedValue(textCompletion('ok'));

    await adapter.complete({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });

    expect(createSpy.mock.calls[0][0].tools).toBeUndefined();
  });

  it('parses a tool_calls response into ChatModelToolCalls, JSON-decoding string arguments', async () => {
    const { adapter, client } = buildAdapter();
    jest.spyOn(client.chat.completions, 'create').mockResolvedValue({
      id: 'chatcmpl_2',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'propose_ecriture', arguments: '{"libelle":"x"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
    } as unknown as OpenAI.Chat.Completions.ChatCompletion);

    const result = await adapter.complete({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'propose' }],
      tools: [],
    });

    expect(result).toEqual({
      content: '',
      toolCalls: [{ id: 'toolu_1', name: 'propose_ecriture', arguments: { libelle: 'x' } }],
    });
  });

  it('throws a clear, named error rather than crashing on malformed JSON tool-call arguments', async () => {
    const { adapter, client } = buildAdapter();
    jest.spyOn(client.chat.completions, 'create').mockResolvedValue({
      id: 'chatcmpl_3',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'propose_ecriture', arguments: 'not json' },
              },
            ],
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
    } as unknown as OpenAI.Chat.Completions.ChatCompletion);

    await expect(
      adapter.complete({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'x' }],
        tools: [],
      }),
    ).rejects.toThrow(/arguments JSON invalides pour l'outil "propose_ecriture"/);
  });

  it('degrades a content-filter refusal to a clear French assistant message', async () => {
    const { adapter, client } = buildAdapter();
    jest.spyOn(client.chat.completions, 'create').mockResolvedValue({
      id: 'chatcmpl_4',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null, refusal: 'policy violation' },
          finish_reason: 'content_filter',
          logprobs: null,
        },
      ],
    } as unknown as OpenAI.Chat.Completions.ChatCompletion);

    const result = await adapter.complete({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.content).toContain('refusé');
    expect(result.content).toContain('policy violation');
  });

  it('degrades an overload finish_reason to a clear French message', async () => {
    const { adapter, client } = buildAdapter();
    jest.spyOn(client.chat.completions, 'create').mockResolvedValue({
      id: 'chatcmpl_5',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null, refusal: null },
          finish_reason: 'insufficient_system_resource',
          logprobs: null,
        },
      ],
    } as unknown as OpenAI.Chat.Completions.ChatCompletion);

    const result = await adapter.complete({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.content).toContain('surchargé');
  });

  it('wraps an authentication error with a clear, named message', async () => {
    const { adapter, client } = buildAdapter();
    const authError = OpenAI.APIError.generate(
      401,
      { error: { message: 'invalid api key' } },
      'invalid api key',
      new Headers(),
    );
    jest.spyOn(client.chat.completions, 'create').mockRejectedValue(authError);

    await expect(
      adapter.complete({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'x' }],
        tools: [],
      }),
    ).rejects.toThrow(/clé API invalide ou révoquée/);
  });

  it('wraps a rate-limit error with a clear, named message', async () => {
    const { adapter, client } = buildAdapter();
    const rateLimitError = OpenAI.APIError.generate(
      429,
      { error: { message: 'too many requests' } },
      'too many requests',
      new Headers(),
    );
    jest.spyOn(client.chat.completions, 'create').mockRejectedValue(rateLimitError);

    await expect(
      adapter.complete({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'x' }],
        tools: [],
      }),
    ).rejects.toThrow(/limite de débit DeepSeek atteinte/);
  });

  it('wraps a connection error with a clear, named message', async () => {
    const { adapter, client } = buildAdapter();
    const connectionError = new OpenAI.APIConnectionError({ message: 'network down' });
    jest.spyOn(client.chat.completions, 'create').mockRejectedValue(connectionError);

    await expect(
      adapter.complete({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'x' }],
        tools: [],
      }),
    ).rejects.toThrow(/connexion à api\.deepseek\.com impossible/);
  });

  it('isAvailable() reports available on a successful models.list() call, without spending a completion', async () => {
    const { adapter, client } = buildAdapter();
    const listSpy = jest.spyOn(client.models, 'list').mockResolvedValue({} as never);
    const createSpy = jest.spyOn(client.chat.completions, 'create');

    const availability = await adapter.isAvailable();

    expect(availability.available).toBe(true);
    expect(listSpy).toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('isAvailable() degrades cleanly (never throws) when the key is invalid', async () => {
    const { adapter, client } = buildAdapter();
    const authError = OpenAI.APIError.generate(
      401,
      { error: { message: 'invalid api key' } },
      'invalid api key',
      new Headers(),
    );
    jest.spyOn(client.models, 'list').mockRejectedValue(authError);

    const availability = await adapter.isAvailable();

    expect(availability.available).toBe(false);
    expect(availability.detail).toContain('clé API invalide ou révoquée');
  });
});
