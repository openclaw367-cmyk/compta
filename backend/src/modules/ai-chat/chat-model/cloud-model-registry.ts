import { CloudModelProvider } from '@prisma/client';
import { ChatModelPort } from './chat-model.port';
import { ClaudeCloudModelAdapter } from './claude-cloud-model.adapter';
import { DeepSeekCloudModelAdapter } from './deepseek-cloud-model.adapter';

/**
 * Which model id each cloud provider is called with for the propose_ecriture
 * write path (see CLAUDE.md "AI chatbot cloud tier"). `claude-opus-5` per
 * the claude-api skill's own guidance for anything non-trivial;
 * `deepseek-v4-pro` per DeepSeek's current docs (api-docs.deepseek.com,
 * checked when the DeepSeek adapter was built — `deepseek-chat`/
 * `deepseek-reasoner` are deprecated). Re-check DeepSeek's docs before ever
 * changing this id — see CLAUDE.md for that exact caveat.
 */
export const CLOUD_MODEL_NAMES: Record<CloudModelProvider, string> = {
  CLAUDE: 'claude-opus-5',
  DEEPSEEK: 'deepseek-v4-pro',
};

/**
 * Constructs the right adapter for a provider, given that company's own
 * decrypted API key. Deliberately the ONE place that switches on
 * `CloudModelProvider` to pick an adapter class — see CLAUDE.md "AI
 * chatbot cloud tier" for why neither adapter is DI-bound (no single
 * instance could serve every company's own key).
 */
export function createCloudModelAdapter(
  provider: CloudModelProvider,
  apiKey: string,
): ChatModelPort {
  switch (provider) {
    case CloudModelProvider.CLAUDE:
      return new ClaudeCloudModelAdapter(apiKey);
    case CloudModelProvider.DEEPSEEK:
      return new DeepSeekCloudModelAdapter(apiKey);
  }
}
