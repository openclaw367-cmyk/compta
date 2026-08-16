import { Module } from '@nestjs/common';
import { LOCAL_MODEL_PORT } from './local-model.port';
import { OllamaLocalModelAdapter } from './ollama-local-model.adapter';

/**
 * The ONE place a concrete local-inference runtime is chosen. Swapping
 * Ollama for a different local runtime later is changing this one
 * provider binding — nothing else in AiChatModule references
 * OllamaLocalModelAdapter directly, only the LOCAL_MODEL_PORT token. See
 * local-model.port.ts.
 */
@Module({
  providers: [{ provide: LOCAL_MODEL_PORT, useClass: OllamaLocalModelAdapter }],
  exports: [LOCAL_MODEL_PORT],
})
export class LocalModelModule {}
