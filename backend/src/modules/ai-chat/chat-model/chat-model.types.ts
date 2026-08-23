/**
 * The normalized shape every ChatModelPort implementation speaks — never
 * a runtime/provider-specific format (Ollama's own /api/chat shape,
 * Claude's Messages API shape, DeepSeek's OpenAI-compatible shape, etc.).
 * Adapters translate to/from this at the boundary; orchestration code
 * never sees a runtime-specific type. See chat-model.port.ts.
 *
 * Named `ChatModel*`, not the bare `Chat*` a reader might expect,
 * specifically to avoid colliding with Prisma's own persisted
 * `ChatMessage`/`ChatSession` entities (`@prisma/client`) — ai-chat.service.ts
 * imports both this module's types and those Prisma types side by side.
 */

export type ChatModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatModelMessage {
  role: ChatModelRole;
  content: string;
  /** Only present on an 'assistant' message that requested tool calls. */
  toolCalls?: ChatModelToolCall[];
  /** Only present on a 'tool' message — which tool call this answers. */
  toolCallId?: string;
  toolName?: string;
}

/** A tool the model may call, described as JSON Schema — the de facto
 * common ground every current tool-calling-capable model (local or
 * cloud) converges on, since they're trained on OpenAI-style
 * function-calling data. */
export interface ChatModelToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatModelCompletionRequest {
  model: string;
  messages: ChatModelMessage[];
  tools: ChatModelToolSpec[];
}

export interface ChatModelCompletionResult {
  /** The model's natural-language reply. Empty when the model only wants to call tools. */
  content: string;
  /** Empty when the model produced a final answer with nothing left to look up. */
  toolCalls: ChatModelToolCall[];
}

export interface ChatModelAvailability {
  available: boolean;
  /** Human-readable — the loaded model name, or why the model is unavailable. */
  detail: string;
}
