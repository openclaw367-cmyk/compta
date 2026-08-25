import type { ChatEngine, CloudProvider } from '../../api/types';

/**
 * Extracted from AssistantPage.tsx (2026-08-25) so the journal-entry
 * "Comptable IA" suggestion flow (see CLAUDE.md "Supporting-document
 * attachments — Part 3") reuses the EXACT same ☁️/🔒 badge markup the
 * assistant already uses — one visual vocabulary for "this content came
 * from a cloud model," not a re-skinned copy.
 */
export function EngineBadge({
  engine,
  cloudProvider,
}: {
  engine: ChatEngine;
  cloudProvider: CloudProvider | null;
}) {
  if (engine === 'CLOUD' && cloudProvider) {
    const label = cloudProvider === 'CLAUDE' ? 'Claude' : 'DeepSeek';
    return (
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10.5px] font-medium text-warning">
        ☁️ {label}
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-positive-soft px-2 py-0.5 text-[10.5px] font-medium text-positive">
      🔒 Local
    </span>
  );
}
