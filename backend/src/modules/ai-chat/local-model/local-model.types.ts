/**
 * The normalized shape every LocalModelPort implementation speaks — never
 * a runtime-specific format (Ollama's own /api/chat shape, an OpenAI-
 * compatible llama.cpp server's shape, etc.). Adapters translate to/from
 * this at the boundary; orchestration code never sees a runtime-specific
 * type. See local-model.port.ts.
 */

export type LocalChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LocalToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LocalChatMessage {
  role: LocalChatRole;
  content: string;
  /** Only present on an 'assistant' message that requested tool calls. */
  toolCalls?: LocalToolCall[];
  /** Only present on a 'tool' message — which tool call this answers. */
  toolCallId?: string;
  toolName?: string;
}

/** A tool the model may call, described as JSON Schema — the de facto
 * common ground every current tool-calling-capable local model converges
 * on, since they're trained on OpenAI-style function-calling data. */
export interface LocalToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LocalCompletionRequest {
  model: string;
  messages: LocalChatMessage[];
  tools: LocalToolSpec[];
}

export interface LocalCompletionResult {
  /** The model's natural-language reply. Empty when the model only wants to call tools. */
  content: string;
  /** Empty when the model produced a final answer with nothing left to look up. */
  toolCalls: LocalToolCall[];
}

export interface LocalModelAvailability {
  available: boolean;
  /** Human-readable — the loaded model name, or why the model is unavailable. */
  detail: string;
}
