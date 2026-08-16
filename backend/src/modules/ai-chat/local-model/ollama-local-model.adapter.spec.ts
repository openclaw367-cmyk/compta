import { ConfigService } from '@nestjs/config';
import { OllamaLocalModelAdapter } from './ollama-local-model.adapter';

function buildAdapter(env: Record<string, string> = {}) {
  const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
  return new OllamaLocalModelAdapter(config);
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('OllamaLocalModelAdapter', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('translates a tool-call response into the normalized LocalCompletionResult shape', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_abc',
              function: { name: 'search_accounts', arguments: { query: '606400' } },
            },
          ],
        },
      }),
    );
    global.fetch = fetchMock;

    const adapter = buildAdapter();
    const result = await adapter.complete({
      model: 'qwen2.5:7b',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'search_accounts', description: 'd', parameters: { type: 'object' } }],
    });

    expect(result).toEqual({
      content: '',
      toolCalls: [{ id: 'call_abc', name: 'search_accounts', arguments: { query: '606400' } }],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('qwen2.5:7b');
    expect(body.stream).toBe(false);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'search_accounts', description: 'd', parameters: { type: 'object' } },
      },
    ]);
  });

  it('synthesizes a tool-call id when the model omits one', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'list_journals', arguments: {} } }],
        },
      }),
    );

    const adapter = buildAdapter();
    const result = await adapter.complete({
      model: 'qwen2.5:7b',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });
    expect(result.toolCalls[0].id).toEqual(expect.any(String));
    expect(result.toolCalls[0].id.length).toBeGreaterThan(0);
  });

  it('returns a final text answer with no tool calls when the model is done', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: { role: 'assistant', content: 'Voici la réponse.' } }),
      );

    const adapter = buildAdapter();
    const result = await adapter.complete({
      model: 'qwen2.5:7b',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });
    expect(result).toEqual({ content: 'Voici la réponse.', toolCalls: [] });
  });

  it('isAvailable() reports available when the configured model is installed', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ models: [{ name: 'qwen2.5:7b', model: 'qwen2.5:7b' }] }));

    const adapter = buildAdapter({ LOCAL_MODEL_NAME: 'qwen2.5:7b' });
    const availability = await adapter.isAvailable();
    expect(availability.available).toBe(true);
    expect(availability.detail).toContain('qwen2.5:7b');
  });

  it('isAvailable() reports unavailable, naming the gap, when the configured model is not installed', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ models: [{ name: 'llama3.1:8b', model: 'llama3.1:8b' }] }));

    const adapter = buildAdapter({ LOCAL_MODEL_NAME: 'qwen2.5:7b' });
    const availability = await adapter.isAvailable();
    expect(availability.available).toBe(false);
    expect(availability.detail).toContain('qwen2.5:7b');
    expect(availability.detail).toContain('llama3.1:8b');
  });

  it('isAvailable() degrades cleanly (never throws) when Ollama is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const adapter = buildAdapter();
    const availability = await adapter.isAvailable();
    expect(availability.available).toBe(false);
    expect(availability.detail).toMatch(/ne répond pas/);
  });

  it('complete() throws a clear, model-named timeout error rather than hanging', async () => {
    global.fetch = jest.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const adapter = buildAdapter({ LOCAL_MODEL_TIMEOUT_MS: '10' });
    await expect(
      adapter.complete({ model: 'qwen2.5:7b', messages: [], tools: [] }),
    ).rejects.toThrow(/n'a pas répondu dans le délai/);
  });
});
