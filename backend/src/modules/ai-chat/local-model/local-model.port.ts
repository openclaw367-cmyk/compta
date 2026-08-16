import {
  LocalCompletionRequest,
  LocalCompletionResult,
  LocalModelAvailability,
} from './local-model.types';

/**
 * The abstraction the chatbot talks to — nothing outside this file (and
 * its concrete adapters) may know a specific local-inference runtime
 * exists. Ollama is ONE implementation behind this interface, not the
 * interface itself: swapping to a different local runtime later (a
 * different llama.cpp server, vLLM, whatever becomes the easy local-run
 * story next) means writing a new class implementing this interface and
 * changing the one DI binding in local-model.module.ts — orchestration
 * code, the tool registry, and the confirmation gate (Phase 2) never
 * change. See CLAUDE.md "AI chatbot".
 *
 * No implementation of this interface may call an external network API.
 * "Local" is a hard constraint of this port, not a default: sensitive
 * accounting data must never leave the machine.
 */
export interface LocalModelPort {
  /** One non-streaming completion turn, with tool-calling support. */
  complete(request: LocalCompletionRequest): Promise<LocalCompletionResult>;

  /**
   * Cheap, side-effect-free check of whether a local model is actually
   * reachable and loaded right now. Never throws — a network error, a
   * missing model, or a runtime that isn't running are all reported as
   * `{ available: false, detail }`, so callers can degrade the chat UI
   * cleanly instead of surfacing a raw connection error.
   */
  isAvailable(): Promise<LocalModelAvailability>;
}

export const LOCAL_MODEL_PORT = Symbol('LOCAL_MODEL_PORT');
