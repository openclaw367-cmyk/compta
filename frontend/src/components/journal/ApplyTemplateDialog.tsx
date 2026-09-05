import { useState } from 'react';
import type { RecurringEntryTemplate } from '../../api/types';
import type { CreateEcritureDto } from '../../api/dto';
import { usePreviewRecurringTemplate } from '../../api/queries';
import { ApiError } from '../../api/client';

/**
 * Picks a template + application date, previews it (resolves accounts/
 * journal/fiscal year, validates — never persists), and hands the
 * resolved dto back to the caller, which opens the ORDINARY
 * EcritureEditor pre-filled with it. See CLAUDE.md "Recurring entries /
 * templates" for why the resolved journalId/fiscalYearId (not
 * necessarily the journal grid's own current tab/exercice) must be what
 * the editor actually submits against.
 */
export function ApplyTemplateDialog({
  templates,
  onResolved,
  onClose,
}: {
  templates: RecurringEntryTemplate[];
  onResolved: (result: { templateId: string; dto: CreateEcritureDto }) => void;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [applicationDate, setApplicationDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const preview = usePreviewRecurringTemplate();

  async function handleContinue() {
    if (!templateId) return;
    setError(null);
    try {
      const result = await preview.mutateAsync({ id: templateId, dto: { applicationDate } });
      onResolved({ templateId, dto: result.dto });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "L'aperçu a échoué.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-template-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="apply-template-title" className="text-[15px] font-semibold text-ink">
          Appliquer un modèle
        </h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Ouvre un brouillon pré-rempli, entièrement modifiable — rien n&rsquo;est enregistré
          avant que vous cliquiez « Enregistrer le brouillon ».
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Modèle
            </span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Date de l&rsquo;écriture
            </span>
            <input
              type="date"
              value={applicationDate}
              onChange={(e) => setApplicationDate(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-negative-soft px-3 py-2 text-[12.5px] text-negative">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!templateId || applicationDate === '' || preview.isPending}
            onClick={() => void handleContinue()}
            className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            {preview.isPending ? 'Vérification…' : 'Continuer'}
          </button>
        </div>
      </div>
    </div>
  );
}
