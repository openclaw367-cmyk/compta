import { Fragment, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useConfirmFecImport, usePreviewFecImport } from '../api/queries';
import { ApiError } from '../api/client';
import type { FecImportPreviewResponse, ImportBatch } from '../api/types';
import { formatMoneyFr, isZeroMoney } from '../lib/money';

type Step =
  | { kind: 'idle' }
  | { kind: 'previewed'; preview: FecImportPreviewResponse }
  | { kind: 'confirmed'; batch: ImportBatch };

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * FEC file import (.txt pipe-delimited per Article A47 A-1 du LPF, .csv,
 * or .xlsx) — bootstraps a company's accounts/journals/écritures from an
 * external FEC export. Same preview-then-confirm shape as ImportExcelPage,
 * but with no fiscal-year picker: the fiscal year is entirely resolved
 * (reused or auto-created) from the file's own date range — see
 * CLAUDE.md "FEC import". Every posted écriture always lands as an
 * unvalidated draft, regardless of the source file's own ValidDate.
 */
export function FecImportPage() {
  const previewImport = usePreviewFecImport();
  const confirmImport = useConfirmFecImport();

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
      const batch = await confirmImport.mutateAsync(file);
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

  const canConfirm =
    step.kind === 'previewed' &&
    step.preview.fileErrors.length === 0 &&
    step.preview.rejected.length === 0 &&
    step.preview.totalEcrituresCount > 0 &&
    !confirmImport.isPending;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Import FEC</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Importez les comptes, journaux et écritures d'une entreprise depuis un fichier FEC
          (.txt, .csv ou .xlsx) — les comptes/journaux manquants sont créés, l'exercice couvrant
          la période du fichier est réutilisé ou créé automatiquement, et chaque écriture
          atterrit toujours en brouillon, à valider ensuite depuis le grand livre.
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Fichier
          </span>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.xlsx"
              onChange={handleFileChange}
              className="hidden"
              id="fec-import-file-input"
            />
            <label
              htmlFor="fec-import-file-input"
              className="cursor-pointer rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-bg"
            >
              Choisir un fichier
            </label>
            <span className="text-[13px] text-ink-muted">
              {file ? file.name : 'Aucun fichier sélectionné (.txt, .csv ou .xlsx)'}
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
          <FecImportPlanSummary preview={step.preview} />
          <FecImportPreviewTable preview={step.preview} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
              className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {confirmImport.isPending ? 'Import…' : "Confirmer l'import"}
            </button>
            {step.preview.rejected.length > 0 && (
              <span className="text-[12.5px] text-ink-muted">
                Corrigez les écritures rejetées et réanalysez le fichier pour pouvoir confirmer.
              </span>
            )}
          </div>
        </>
      )}

      {step.kind === 'confirmed' && (
        <div className="rounded-md bg-positive-soft px-4 py-3 text-[13px] text-positive">
          Import réussi : {step.batch.ecritures?.length ?? 0} écriture
          {(step.batch.ecritures?.length ?? 0) > 1 ? 's' : ''} créée
          {(step.batch.ecritures?.length ?? 0) > 1 ? 's' : ''} en brouillon — à valider depuis le
          grand livre ou l'écran Écritures.
        </div>
      )}
    </div>
  );
}

function FecImportPlanSummary({ preview }: { preview: FecImportPreviewResponse }) {
  return (
    <div className="flex flex-col gap-3">
      {preview.fiscalYearPlan && (
        <div className="rounded-md border border-border bg-bg px-4 py-2.5 text-[13px]">
          {preview.fiscalYearPlan.action === 'REUSE_EXISTING' ? (
            <>
              Utilisera l'exercice existant <strong>« {preview.fiscalYearPlan.label} »</strong> (
              {formatDate(preview.fiscalYearPlan.startDate)} →{' '}
              {formatDate(preview.fiscalYearPlan.endDate)}).
            </>
          ) : (
            <>
              Créera un nouvel exercice <strong>« {preview.fiscalYearPlan.label} »</strong> (
              {formatDate(preview.fiscalYearPlan.startDate)} →{' '}
              {formatDate(preview.fiscalYearPlan.endDate)}), aucun exercice existant ne couvrant
              cette période.
            </>
          )}
        </div>
      )}

      {preview.journalsToCreate.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="border-b border-border bg-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {preview.journalsToCreate.length} journal
            {preview.journalsToCreate.length > 1 ? 'aux' : ''} à créer
          </div>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {preview.journalsToCreate.map((j) => (
                <tr key={j.code} className="border-b border-border last:border-b-0">
                  <td className="w-20 px-4 py-2 tabular-nums text-ink-muted">{j.code}</td>
                  <td className="px-4 py-2 text-ink">{j.label}</td>
                  <td className="px-4 py-2 text-right">
                    {j.typeConfident ? (
                      <span className="text-ink-muted">{j.inferredType}</span>
                    ) : (
                      <span
                        className="text-warning"
                        title="Type non reconnu automatiquement — vérifiez et corrigez depuis Comptes & journaux si besoin."
                      >
                        {j.inferredType} (à vérifier)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.accountsToCreate.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="border-b border-border bg-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {preview.accountsToCreate.length} compte
            {preview.accountsToCreate.length > 1 ? 's' : ''} à créer
          </div>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {preview.accountsToCreate.map((a) => (
                <tr key={a.number} className="border-b border-border last:border-b-0">
                  <td className="w-24 px-4 py-2 tabular-nums text-ink-muted">{a.number}</td>
                  <td className="px-4 py-2 text-ink">{a.label}</td>
                  <td className="px-4 py-2 text-right text-ink-faint">
                    {a.isAuxiliary ? `Tiers de ${a.parentNumber}` : `Classe ${a.pcgClass}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FecImportPreviewTable({ preview }: { preview: FecImportPreviewResponse }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const duplicateCount = preview.toImport.filter((g) => g.isDuplicate).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-positive-soft px-3 py-1 text-[12.5px] font-medium text-positive">
          {preview.totalEcrituresCount} à importer
        </span>
        {preview.truncated && (
          <span className="text-[12px] text-ink-faint">
            (aperçu limité aux {preview.toImport.length} premières — l'import complet traite
            toutes les écritures)
          </span>
        )}
        {preview.rejected.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-negative-soft px-3 py-1 text-[12.5px] font-medium text-negative">
            {preview.rejected.length} rejetée{preview.rejected.length > 1 ? 's' : ''}
          </span>
        )}
        {duplicateCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-warning-soft px-3 py-1 text-[12.5px] font-medium text-warning">
            {duplicateCount} doublon{duplicateCount > 1 ? 's' : ''} possible
            {duplicateCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {preview.toImport.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Journal</th>
                <th className="px-4 py-2.5 font-semibold">N° source</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Libellé</th>
                <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {preview.toImport.map((group) => {
                const key = `${group.journalCode} ${group.sourceEcritureNum}`;
                const isExpanded = expandedKey === key;
                return (
                  <Fragment key={key}>
                    <tr
                      onClick={() => setExpandedKey(isExpanded ? null : key)}
                      className={[
                        'cursor-pointer border-b border-border last:border-b-0',
                        isExpanded ? 'bg-accent-soft' : 'hover:bg-bg',
                      ].join(' ')}
                    >
                      <td className="px-4 py-2.5 text-ink-muted">{group.journalCode}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{group.sourceEcritureNum}</td>
                      <td className="px-4 py-2.5 tabular-nums text-ink">
                        {formatDate(group.ecritureDate)}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-ink">{group.libelle}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                        {formatMoneyFr(group.total)}
                      </td>
                      <td className="px-4 py-2.5">
                        {group.isDuplicate && (
                          <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                            Doublon possible
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <div className="border-t border-border bg-bg px-5 py-3">
                            {group.isDuplicate && (
                              <p className="mb-2 text-[12.5px] text-warning">
                                Doublon possible : {group.duplicateOf}
                              </p>
                            )}
                            <table className="w-full border-collapse text-[12.5px]">
                              <thead>
                                <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
                                  <th className="py-1.5 pr-3 font-semibold">Compte</th>
                                  <th className="py-1.5 pr-3 text-right font-semibold">Débit</th>
                                  <th className="py-1.5 pr-3 text-right font-semibold">Crédit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.lignes.map((ligne, index) => (
                                  <tr key={index} className="border-b border-border/70 last:border-b-0">
                                    <td className="py-1.5 pr-3 text-ink">
                                      <span className="tabular-nums text-ink-muted">
                                        {ligne.compteNum}
                                        {ligne.compAuxNum ? ` / ${ligne.compAuxNum}` : ''}
                                      </span>{' '}
                                      {ligne.compteLib}
                                    </td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                                      {isZeroMoney(ligne.debit) ? '—' : formatMoneyFr(ligne.debit)}
                                    </td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                                      {isZeroMoney(ligne.credit) ? '—' : formatMoneyFr(ligne.credit)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {preview.rejected.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-negative-soft bg-surface">
          <div className="border-b border-negative-soft bg-negative-soft px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-negative">
            Rejeté — ne sera pas importé
          </div>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {preview.rejected.map((group, index) => (
                <tr key={index} className="border-b border-border last:border-b-0">
                  <td className="w-32 px-4 py-2.5 align-top text-ink-muted">
                    {group.journalCode} / {group.sourceEcritureNum}
                  </td>
                  <td className="px-4 py-2.5 text-negative">
                    {group.errors.map((error, errIndex) => (
                      <div key={errIndex}>{error}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
