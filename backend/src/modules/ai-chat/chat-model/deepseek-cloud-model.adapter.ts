import OpenAI from 'openai';
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
 * Host-pinned deliberately — `api.deepseek.com` only, never a caller-supplied
 * base URL, same discipline as ClaudeCloudModelAdapter's ANTHROPIC_BASE_URL.
 * Passed explicitly to the client so it can never be overridden by an
 * ambient `OPENAI_BASE_URL` env var either — see CLAUDE.md "AI chatbot
 * cloud tier".
 */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * DeepSeek's own docs (api-docs.deepseek.com/quick_start/pricing, checked
 * this session) cap max output at 384K tokens with no stated default — a
 * ceiling far beyond anything this narrow propose_ecriture task needs.
 * 8000 is a deliberate, conservative cap chosen for THIS task, not a
 * discovered DeepSeek default; costs nothing extra unless actually reached.
 */
const MAX_TOKENS = 8000;

/**
 * ONE implementation of ChatModelPort, talking to DeepSeek. DeepSeek's API
 * is deliberately OpenAI-Chat-Completions-compatible (confirmed against
 * api-docs.deepseek.com this session — same request/response shape, same
 * tool-calling convention) and DeepSeek's own docs recommend the official
 * `openai` package pointed at their base URL rather than a bespoke client —
 * that is what this file does. This is NOT the "never fall back to an
 * OpenAI-compatible shim" case from the claude-api reference — that rule is
 * about calling Claude through someone else's shim; DeepSeek genuinely IS
 * an OpenAI-compatible provider, and `openai` is the correct, documented
 * client for it.
 *
 * Deliberately NOT DI-bound, same reasoning as ClaudeCloudModelAdapter: a
 * DeepSeek adapter needs a COMPANY'S OWN decrypted API key (see
 * CloudCredentialsService.getDecryptedKey()), so no single instance could
 * serve every company. Constructed directly, per turn, by whichever future
 * orchestration code handles an explicitly-opted-in cloud turn — see
 * CLAUDE.md "AI chatbot cloud tier".
 *
 * Unlike Claude's Messages API, OpenAI-shaped tool results do NOT need
 * merging into one turn — each `{role: "tool", tool_call_id, content}`
 * message stands on its own in the array; see toDeepSeekMessages()'s own
 * comment for why this translation is simpler than Claude's.
 */
export class DeepSeekCloudModelAdapter implements ChatModelPort {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });
  }

  async complete(request: ChatModelCompletionRequest): Promise<ChatModelCompletionResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: request.model,
        max_tokens: MAX_TOKENS,
        messages: toDeepSeekMessages(request.messages),
        tools: request.tools.length > 0 ? request.tools.map(toDeepSeekTool) : undefined,
      });
      return fromDeepSeekResponse(response);
    } catch (err) {
      throw new Error(`DeepSeek (${request.model}) n'a pas pu répondre : ${describeError(err)}`);
    }
  }

  /**
   * Cheap, side-effect-free key/reachability check — lists available
   * models rather than running a completion, same reasoning as
   * ClaudeCloudModelAdapter.isAvailable(): no fixed model to check, since
   * `model` arrives per-call in ChatModelCompletionRequest.
   */
  async isAvailable(): Promise<ChatModelAvailability> {
    try {
      await this.client.models.list();
      return { available: true, detail: 'Clé API DeepSeek valide, api.deepseek.com joignable.' };
    } catch (err) {
      return { available: false, detail: `DeepSeek indisponible : ${describeError(err)}` };
    }
  }
}

function toDeepSeekMessages(
  messages: ChatModelMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === 'system') {
      return { role: 'system', content: message.content };
    }
    if (message.role === 'user') {
      return { role: 'user', content: message.content };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content.length > 0 ? message.content : null,
        tool_calls:
          message.toolCalls && message.toolCalls.length > 0
            ? message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              }))
            : undefined,
      };
    }
    // role === 'tool' — a plain, standalone message, no batching required
    // (contrast ClaudeCloudModelAdapter's toClaudeRequest(), which must
    // merge consecutive tool results into one Claude user turn).
    return { role: 'tool', content: message.content, tool_call_id: message.toolCallId ?? '' };
  });
}

function toDeepSeekTool(spec: ChatModelToolSpec): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: { name: spec.name, description: spec.description, parameters: spec.parameters },
  };
}

function fromDeepSeekResponse(
  response: OpenAI.Chat.Completions.ChatCompletion,
): ChatModelCompletionResult {
  const choice = response.choices[0];
  if (!choice) {
    throw new Error("DeepSeek n'a retourné aucun choix de réponse.");
  }
  const message = choice.message;

  if (message.refusal || choice.finish_reason === 'content_filter') {
    return {
      content:
        'DeepSeek a refusé cette demande' +
        (message.refusal ? ` : ${message.refusal}` : '') +
        " — reformulez, ou continuez en local. Aucune écriture n'a été proposée.",
      toolCalls: [],
    };
  }
  if ((choice.finish_reason as string) === 'insufficient_system_resource') {
    return {
      content: "DeepSeek est temporairement surchargé et n'a pas pu traiter la demande. Réessayez.",
      toolCalls: [],
    };
  }

  const toolCalls: ChatModelToolCall[] = (message.tool_calls ?? [])
    .filter(
      (call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
        call.type === 'function',
    )
    .map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseToolArguments(call.function.name, call.function.arguments),
    }));

  return { content: message.content ?? '', toolCalls };
}

function parseToolArguments(name: string, raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `DeepSeek a renvoyé des arguments JSON invalides pour l'outil "${name}" : ${raw}`,
    );
  }
}

function describeError(err: unknown): string {
  if (err instanceof OpenAI.AuthenticationError) {
    return 'clé API invalide ou révoquée';
  }
  if (err instanceof OpenAI.RateLimitError) {
    return 'limite de débit DeepSeek atteinte, réessayez plus tard';
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return 'connexion à api.deepseek.com impossible';
  }
  if (err instanceof OpenAI.APIError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
