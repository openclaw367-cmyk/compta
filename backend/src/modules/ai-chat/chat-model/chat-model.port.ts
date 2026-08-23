import {
  ChatModelCompletionRequest,
  ChatModelCompletionResult,
  ChatModelAvailability,
} from './chat-model.types';

/**
 * The abstraction the chatbot talks to — nothing outside this file (and
 * its concrete adapters) may know a specific inference runtime or
 * provider exists. `OllamaLocalModelAdapter` (fully local) and the cloud
 * adapters (Claude, DeepSeek — see CLAUDE.md "AI chatbot cloud tier") are
 * all implementations behind this ONE interface, not the interface
 * itself: swapping or adding a runtime/provider means writing a new class
 * implementing this interface and changing/adding one DI binding in
 * chat-model.module.ts — orchestration code, the tool registry, and the
 * confirmation gate (Phase 2) never change regardless of which side of
 * this port answers.
 *
 * This port itself does NOT constrain an implementation to stay local —
 * that constraint lived here when only `OllamaLocalModelAdapter` existed,
 * but a cloud adapter is a deliberate, explicit exception to it, gated
 * entirely at the call site (which port token is injected for a given
 * turn), never here. See CLAUDE.md "AI chatbot cloud tier" for the
 * consent/indicator/minimization mechanics that make a cloud adapter safe
 * to add without weakening the local-first default.
 */
export interface ChatModelPort {
  /** One non-streaming completion turn, with tool-calling support. */
  complete(request: ChatModelCompletionRequest): Promise<ChatModelCompletionResult>;

  /**
   * Cheap, side-effect-free check of whether this model is actually
   * reachable right now. Never throws — a network error, a missing model,
   * or a runtime/provider that isn't reachable are all reported as
   * `{ available: false, detail }`, so callers can degrade the chat UI
   * cleanly instead of surfacing a raw connection error.
   */
  isAvailable(): Promise<ChatModelAvailability>;
}

export const CHAT_MODEL_PORT = Symbol('CHAT_MODEL_PORT');
