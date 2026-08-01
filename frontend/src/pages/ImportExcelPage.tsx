import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useConfirmImport, useFiscalYears, usePreviewImport } from '../api/queries';
import { ApiError } from '../api/client';
import type { ImportBatch, ImportPreviewResponse } from '../api/types';
import { ImportPreviewTable } from '../components/import/ImportPreviewTable';

const NO_FISCAL_YEARS: never[] = [];

type Step =
  | { kind: 'idle' }
  | { kind: 'previewed'; preview: ImportPreviewResponse }
  | { kind: 'confirmed'; batch: ImportBatch };

export function ImportExcelPage() {
  const fiscalYearsQuery = useFiscalYears();
  const fiscalYears = fiscalYearsQuery.data ?? NO_FISCAL_YEARS;
  const previewImport = usePreviewImport();
  const confirmImport = useConfirmImport();

  const [fiscalYearId, setFiscalYearId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!fiscalYearId && fiscalYears.length > 0) setFiscalYearId(fiscalYears[0].id);
  }, [fiscalYearId, fiscalYears]);

  const selectedFiscalYear = fiscalYears.find((fy) => fy.id === fiscalYearId);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setStep({ kind: 'idle' });
    setError(null);
  }

  async function handlePreview() {
    if (!file || !fiscalYearId) return;
    setError(null);
    try {
      const preview = await previewImport.mutateAsync({ fiscalYearId, file });
      setStep({ kind: 'previewed', preview });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['La prévisualisation a échoué.']);
    }
  }

  async function handleConfirm() {
    if (!file || !fiscalYearId) return;
    setError(null);
    try {
      const batch = await confirmImport.mutateAsync({ fiscalYearId, file });
      setStep({ kind: 'confirmed', batch });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ["L'import a échoué."]);
    }
  }

  function reset() {
    setFile(null);
    setStep({ kind: 'idle' });
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const canPreview =
    Boolean(file) &&
    Boolean(fiscalYearId) &&
    !selectedFiscalYear?.closedAt &&
    !previewImport.isPending;
  const canConfirm =
    step.kind === 'previewed' &&
    step.preview.fileErrors.length === 0 &&
    step.preview.rejected.length === 0 &&
    step.preview.toImport.length > 0 &&
    !confirmImport.isPending;

  if (fiscalYearsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Import Excel</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Importez un journal depuis un classeur .xlsx — aperçu avant tout import réel, rien
          n'est écrit tant que vous n'avez pas confirmé.
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <Field label="Exercice">
          <select
            value={fiscalYearId ?? ''}
            onChange={(e) => setFiscalYearId(e.target.value)}
            className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
          >
            {fiscalYears.map((fy) => (
              <option key={fy.id} value={fy.id}>
                {fy.label}
              </option>
            ))}
          </select>
        </Field>

        {selectedFiscalYear?.closedAt && (
          <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
            L'exercice « {selectedFiscalYear.label} » est clôturé — aucun import possible.
          </div>
        )}

        <Field label="Fichier">
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              className="hidden"
              id="import-file-input"
            />
            <label
              htmlFor="import-file-input"
              className="cursor-pointer rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-bg"
            >
              Choisir un fichier
            </label>
            <span className="text-[13px] text-ink-muted">
              {file ? file.name : 'Aucun fichier sélectionné (.xlsx)'}
            </span>
          </div>
        </Field>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={!canPreview}
            className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            {previewImport.isPending ? 'Analyse…' : 'Aperçu'}
          </button>
          {(file || step.kind !== 'idle') && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md px-3 py-2 text-[13px] font-medium text-ink-muted hover:bg-bg"
            >
              Réinitialiser
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
          {error.map((message, index) => (
            <div key={index}>{message}</div>
          ))}
        </div>
      )}

      {step.kind === 'previewed' && step.preview.fileErrors.length > 0 && (
        <div className="rounded-md bg-negative-soft px-4 py-3 text-[13px] text-negative">
          <p className="mb-1 font-semibold">Le fichier n'a pas pu être analysé :</p>
          {step.preview.fileErrors.map((message, index) => (
            <div key={index}>{message}</div>
          ))}
        </div>
      )}

      {step.kind === 'previewed' && step.preview.fileErrors.length === 0 && (
        <>
          <ImportPreviewTable preview={step.preview} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
              className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {confirmImport.isPending ? 'Import…' : 'Confirmer l\'import'}
            </button>
            {step.preview.rejected.length > 0 && (
              <span className="text-[12.5px] text-ink-muted">
                Corrigez les écritures rejetées et réimportez le fichier pour pouvoir confirmer.
              </span>
            )}
          </div>
        </>
      )}

      {step.kind === 'confirmed' && (
        <div className="rounded-md bg-positive-soft px-4 py-3 text-[13px] text-positive">
          Import réussi : {step.batch.ecritures?.length ?? 0} écriture
          {(step.batch.ecritures?.length ?? 0) > 1 ? 's' : ''} créée
          {(step.batch.ecritures?.length ?? 0) > 1 ? 's' : ''} en brouillon.
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
