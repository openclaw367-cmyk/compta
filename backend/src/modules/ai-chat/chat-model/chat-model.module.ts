import { Module } from '@nestjs/common';
import { CHAT_MODEL_PORT } from './chat-model.port';
import { OllamaLocalModelAdapter } from './ollama-local-model.adapter';

/**
 * The ONE place a concrete model provider is bound to CHAT_MODEL_PORT for
 * the default (local, read) path. `OllamaLocalModelAdapter` is bound here
 * unconditionally — this module never chooses a cloud adapter itself, so
 * importing it can never silently route accounting data off the machine.
 * The cloud-opt-in write path (see CLAUDE.md "AI chatbot cloud tier")
 * injects a cloud adapter directly at its own, separate, explicitly-gated
 * call site instead of through this binding — nothing here changes when
 * that lands.
 */
@Module({
  providers: [{ provide: CHAT_MODEL_PORT, useClass: OllamaLocalModelAdapter }],
  exports: [CHAT_MODEL_PORT],
})
export class ChatModelModule {}
