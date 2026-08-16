import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalModelPort } from './local-model.port';
import {
  LocalChatMessage,
  LocalCompletionRequest,
  LocalCompletionResult,
  LocalModelAvailability,
  LocalToolCall,
} from './local-model.types';

interface OllamaToolCall {
  id?: string;
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaChatResponse {
  message: { role: string; content: string; tool_calls?: OllamaToolCall[] };
}

interface OllamaTagsResponse {
  models: { name: string; model: string }[];
}

/**
 * ONE implementation of LocalModelPort, talking to a local Ollama daemon's
 * /api/chat over loopback HTTP. Nothing outside this file knows Ollama's
 * request/response shapes — see local-model.port.ts for why that matters.
 */
@Injectable()
export class OllamaLocalModelAdapter implements LocalModelPort {
  private readonly logger = new Logger(OllamaLocalModelAdapter.name);
  private readonly baseUrl: string;
  private readonly modelName: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    // Loopback by default, deliberately — never point this at a remote host
    // without an explicit, obvious override. See CLAUDE.md "AI chatbot".
    this.baseUrl = config.get<string>('LOCAL_MODEL_BASE_URL') ?? 'http://localhost:11434';
    this.modelName = config.get<string>('LOCAL_MODEL_NAME') ?? 'qwen2.5:7b';
    this.timeoutMs = Number(config.get<string>('LOCAL_MODEL_TIMEOUT_MS') ?? '120000');
  }

  async complete(request: LocalCompletionRequest): Promise<LocalCompletionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map(toOllamaMessage),
          tools: request.tools.length > 0 ? request.tools.map(toOllamaTool) : undefined,
          stream: false,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama returned HTTP ${response.status}: ${body.slice(0, 500)}`);
      }
      const body = (await response.json()) as OllamaChatResponse;
      return {
        content: body.message.content ?? '',
        toolCalls: (body.message.tool_calls ?? []).map(toLocalToolCall),
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `Le modèle local (${request.model}) n'a pas répondu dans le délai de ${this.timeoutMs}ms.`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async isAvailable(): Promise<LocalModelAvailability> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) {
        return {
          available: false,
          detail: `Ollama a répondu avec le statut HTTP ${response.status}.`,
        };
      }
      const body = (await response.json()) as OllamaTagsResponse;
      const installed = body.models.map((m) => m.name);
      if (!installed.includes(this.modelName)) {
        return {
          available: false,
          detail:
            installed.length > 0
              ? `Le modèle configuré "${this.modelName}" n'est pas installé. Modèles disponibles : ` +
                `${installed.join(', ')}. Lancez "ollama pull ${this.modelName}" ou changez ` +
                'LOCAL_MODEL_NAME.'
              : `Aucun modèle Ollama n'est installé. Lancez "ollama pull ${this.modelName}".`,
        };
      }
      return { available: true, detail: `${this.modelName} prêt via Ollama (${this.baseUrl}).` };
    } catch (err) {
      this.logger.debug(`Ollama unreachable at ${this.baseUrl}: ${(err as Error).message}`);
      return {
        available: false,
        detail: `Ollama ne répond pas sur ${this.baseUrl} — est-il lancé ? ("ollama serve")`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toOllamaMessage(message: LocalChatMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls && message.toolCalls.length > 0
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            function: { name: call.name, arguments: call.arguments },
          })),
        }
      : {}),
  };
}

function toOllamaTool(spec: LocalCompletionRequest['tools'][number]): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: spec.name, description: spec.description, parameters: spec.parameters },
  };
}

let fallbackCallCounter = 0;

function toLocalToolCall(call: OllamaToolCall): LocalToolCall {
  return {
    // Not every tool-calling model emits an id — synthesize a stable one
    // so downstream code (trace persistence, tool-result matching) never
    // has to special-case "the id was missing."
    id: call.id ?? `local-${Date.now()}-${fallbackCallCounter++}`,
    name: call.function.name,
    arguments: call.function.arguments,
  };
}
