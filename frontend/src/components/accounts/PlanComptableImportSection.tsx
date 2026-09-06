import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  useConfirmPlanComptableImport,
  usePreviewPlanComptableImport,
} from '../../api/queries';
import { ApiError } from '../../api/client';
import type { PlanComptableImportPreviewResponse, PlanComptableImportResult } from '../../api/types';

type Step =
  | { kind: 'idle' }
  | { kind: 'previewed'; preview: PlanComptableImportPreviewResponse }
  | { kind: 'confirmed'; result: PlanComptableImportResult };

const PCG_CLASS_LABEL: Record<number, string> = {
  1: 'Classe 1',
  2: 'Classe 2',
  3: 'Classe 3',
  4: 'Classe 4',
  5: 'Classe 5',
  6: 'Classe 6',
  7: 'Classe 7',
  8: 'Classe 8',
};

/**
 * Bulk create-or-update the chart of accounts from an Excel sheet —
 * required columns CompteNum/CompteLib, plus optional CompteParentNum
 * (marks the row as a tiers under that 401/411/455 collectif) and six
 * optional identity columns (Adresse, CodePostal, Ville, PaysISO,
 * SirenRci, NumeroTva). Preview-then-confirm, same shape as Import
 * FEC/Excel — see CLAUDE.md "Plan Comptable". Purely additive/upsert:
 * an existing CompteNum is updated (label + identity), a new one is
 * created; nothing absent from the file is ever touched or deleted.
 */
export function PlanComptableImportSection({ onClose }: { onClose: () => void }) {
  const previewImport = usePreviewPlanComptableImport();
  const confirmImport = useConfirmPlanComptableImport();

  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setStep({ kind: 'idle' });
    setError(null);
  }

  async function handlePreview() {
    if (!file) return;
    setError(null);
    try {
      const preview = await previewImport.mutateAsync(file);
      setStep({ kind: 'previewed', preview });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ["L'analyse a échoué."]);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setError(null);
    try {
      const result = await confirmImport.mutateAsync(file);
      setStep({ kind: 'confirmed', result });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ["L'import a échoué."]);
    }
  }

  const canConfirm =
    step.kind === 'previewed' &&
    step.preview.errors.length === 0 &&
    step.preview.totalRowCount > 0 &&
    !confirmImport.isPending;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[13.5px] font-semibold text-ink">Importer depuis Excel</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            Colonnes : <code className="text-ink">CompteNum</code>,{' '}
            <code className="text-ink">CompteLib</code> (obligatoires),{' '}
            <code className="text-ink">CompteParentNum</code> (pour un tiers, sous 401/411/455),
            et optionnellement <code className="text-ink">Adresse</code>,{' '}
            <code className="text-ink">CodePostal</code>, <code className="text-ink">Ville</code>,{' '}
            <code className="text-ink">PaysISO</code>, <code className="text-ink">SirenRci</code>,{' '}
            <code className="text-ink">NumeroTva</code>. Un numéro déjà existant est mis à jour
            (libellé/identité), un nouveau est créé — rien n'est jamais supprimé.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-[12px] font-medium text-ink-muted hover:bg-bg hover:text-ink"
        >
          Fermer
        </button>
      </div>

      {step.kind === 'confirmed' ? (
        <div className="rounded-md bg-positive-soft px-4 py-3 text-[13px] text-positive">
          Import terminé — {step.result.createdCount} compte(s) créé(s),{' '}
          {step.result.updatedCount} compte(s) mis à jour.
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Fichier
            </span>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                onChange={handleFileChange}
                className="hidden"
                id="plan-comptable-import-file-input"
              />
              <label
                htmlFor="plan-comptable-import-file-input"
                className="cursor-pointer rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-bg"
              >
                Choisir un fichier
              </label>
              <span className="text-[13px] text-ink-muted">
                {file ? file.name : 'Aucun fichier sélectionné (.xlsx)'}
              </span>
            </div>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={!file || previewImport.isPending}
              className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {previewImport.isPending ? 'Analyse…' : 'Analyser'}
            </button>
            {step.kind === 'previewed' && (
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={!canConfirm}
                className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
              >
                {confirmImport.isPending ? 'Import…' : "Confirmer l'import"}
              </button>
            )}
          </div>

          {error && (
            <div className="rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
              {error.map((message, index) => (
                <div key={index}>{message}</div>
              ))}
            </div>
          )}

          {step.kind === 'previewed' && step.preview.errors.length > 0 && (
            <div className="rounded-md bg-negative-soft px-4 py-3 text-[13px] text-negative">
              <p className="mb-1 font-semibold">
                {step.preview.errors.length} erreur(s) — corrigez le fichier et réanalysez :
              </p>
              {step.preview.errors.map((message, index) => (
                <div key={index}>{message}</div>
              ))}
            </div>
          )}

          {step.kind === 'previewed' && step.preview.errors.length === 0 && (
            <>
              <p className="text-[12.5px] text-ink-muted">
                {step.preview.createCount} à créer, {step.preview.updateCount} à mettre à jour
                {step.preview.truncated &&
                  ` (aperçu limité aux ${step.preview.rows.length} premières lignes sur ${step.preview.totalRowCount})`}
                .
              </p>
              <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                      <th className="px-3 py-2">N°</th>
                      <th className="px-3 py-2">Libellé</th>
                      <th className="px-3 py-2">Classe</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {step.preview.rows.map((row) => (
                      <tr key={row.rowNumber} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-1.5 tabular-nums text-ink-muted">{row.number}</td>
                        <td className="px-3 py-1.5 text-ink">
                          {row.label}
                          {row.parentNumber && (
                            <span className="ml-1.5 text-[11px] text-ink-faint">
                              (tiers sous {row.parentNumber})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-ink-muted">
                          {PCG_CLASS_LABEL[row.pcgClass] ?? row.pcgClass}
                        </td>
                        <td className="px-3 py-1.5 text-ink-muted">
                          {row.isAuxiliary ? 'Tiers' : 'Compte'}
                        </td>
                        <td className="px-3 py-1.5">
                          <span
                            className={
                              row.action === 'CREATE'
                                ? 'rounded px-1.5 py-0.5 text-[11px] font-medium text-positive'
                                : 'rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-muted'
                            }
                          >
                            {row.action === 'CREATE' ? 'Créer' : 'Mettre à jour'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
