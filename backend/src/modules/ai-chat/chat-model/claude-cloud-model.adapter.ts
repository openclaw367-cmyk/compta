import Anthropic from '@anthropic-ai/sdk';
import { ChatModelPort } from './chat-model.port';
import {
  ChatModelAvailability,
  ChatModelCompletionRequest,
  ChatModelCompletionResult,
  ChatModelMessage,
  ChatModelToolCall,
  ChatModelToolSpec,
} from './chat-model.types';

/**
 * Host-pinned deliberately — `api.anthropic.com` only, never a caller-supplied
 * base URL (unlike OllamaLocalModelAdapter's LOCAL_MODEL_BASE_URL, which is
 * meant to be pointed anywhere on the LAN). Passed explicitly to the SDK
 * client so it can never be overridden by an ambient ANTHROPIC_BASE_URL env
 * var either — see CLAUDE.md "AI chatbot cloud tier".
 */
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/**
 * Non-streaming default per the claude-api skill's guidance (keeps responses
 * under SDK HTTP timeouts); costs nothing extra unless actually reached —
 * Anthropic bills on tokens generated, not on this ceiling.
 */
const MAX_TOKENS = 16000;

/**
 * ONE implementation of ChatModelPort, talking to Claude via the official
 * `@anthropic-ai/sdk` (never raw fetch — that SDK exists and this codebase's
 * claude-api skill requires using it). Nothing outside this file knows
 * Claude's Messages API request/response shapes — see chat-model.port.ts for
 * why that matters.
 *
 * Deliberately NOT DI-bound (no @Injectable, no binding in
 * chat-model.module.ts): unlike OllamaLocalModelAdapter, which reads one
 * shared model/base-URL from global config, a Claude adapter needs a
 * COMPANY'S OWN decrypted API key (see CloudCredentialsService.getDecryptedKey())
 * — there is no single instance that could serve every company. Whichever
 * future orchestration code handles an explicitly-opted-in cloud turn (see
 * CLAUDE.md "AI chatbot cloud tier" — the per-thread granularity/consent
 * design) constructs one of these directly with that company's key, for
 * that turn only.
 *
 * `thinking: {type: "adaptive"}` is passed explicitly on every call, not
 * left to omission — disabled thinking on current Claude models can cause a
 * tool call to be written as plain text instead of a real structured
 * `tool_use` block (the exact class of failure the local-model benchmark
 * that motivated this whole cloud tier was built to escape — see CLAUDE.md
 * "AI chatbot Phase 2" §5b). Never disable thinking on this path.
 */
export class ClaudeCloudModelAdapter implements ChatModelPort {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL });
  }

  async complete(request: ChatModelCompletionRequest): Promise<ChatModelCompletionResult> {
    const { system, messages } = toClaudeRequest(request.messages);
    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        system,
        messages,
        tools: request.tools.length > 0 ? request.tools.map(toClaudeTool) : undefined,
      });
      return fromClaudeResponse(response);
    } catch (err) {
      throw new Error(`Claude (${request.model}) n'a pas pu répondre : ${describeError(err)}`);
    }
  }

  /**
   * Cheap, side-effect-free key/reachability check — lists available models
   * rather than running a completion, so it never spends completion tokens
   * and needs no specific model name (unlike OllamaLocalModelAdapter's
   * isAvailable(), which must check ONE configured model — this adapter has
   * no such fixed model, since `model` arrives per-call in
   * ChatModelCompletionRequest).
   */
  async isAvailable(): Promise<ChatModelAvailability> {
    try {
      await this.client.models.list();
      return { available: true, detail: 'Clé API Claude valide, api.anthropic.com joignable.' };
    } catch (err) {
      return { available: false, detail: `Claude indisponible : ${describeError(err)}` };
    }
  }
}

function toClaudeRequest(messages: ChatModelMessage[]): {
  system: string | undefined;
  messages: Anthropic.MessageParam[];
} {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const system = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;

  const claudeMessages: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }
    if (message.role === 'user') {
      claudeMessages.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (message.content) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      claudeMessages.push({ role: 'assistant', content: blocks });
      continue;
    }
    // role === 'tool' — merged into the preceding user turn's tool_result
    // blocks when possible, rather than one user turn per result: Claude's
    // own guidance is that splitting parallel tool results across separate
    // messages "silently trains Claude to stop making parallel calls" (see
    // shared/tool-use-concepts.md, Parallel tool use).
    const resultBlock: Anthropic.ToolResultBlockParam = {
      type: 'tool_result',
      tool_use_id: message.toolCallId ?? '',
      content: message.content,
    };
    const last = claudeMessages[claudeMessages.length - 1];
    if (
      last &&
      last.role === 'user' &&
      Array.isArray(last.content) &&
      last.content.every((block) => block.type === 'tool_result')
    ) {
      last.content.push(resultBlock);
    } else {
      claudeMessages.push({ role: 'user', content: [resultBlock] });
    }
  }
  return { system, messages: claudeMessages };
}

function toClaudeTool(spec: ChatModelToolSpec): Anthropic.Tool {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.parameters as Anthropic.Tool.InputSchema,
  };
}

function fromClaudeResponse(response: Anthropic.Message): ChatModelCompletionResult {
  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category ?? null;
    return {
      content:
        'Le modèle Claude a refusé cette demande' +
        (category ? ` (catégorie : ${category})` : '') +
        " — reformulez, ou continuez en local. Aucune écriture n'a été proposée.",
      toolCalls: [],
    };
  }

  const textParts: string[] = [];
  const toolCalls: ChatModelToolCall[] = [];
  for (const block of response.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      });
    }
  }
  return { content: textParts.join(''), toolCalls };
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'clé API invalide ou révoquée';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'limite de débit Claude atteinte, réessayez plus tard';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'connexion à api.anthropic.com impossible';
  }
  if (err instanceof Anthropic.APIError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
