import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useFixedAsset, useGenerateSchedule, usePostDotation, useSchedule } from '../api/queries';
import { ApiError } from '../api/client';
import { formatMoneyFr } from '../lib/money';

const NO_SCHEDULE: never[] = [];

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function FixedAssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const assetId = id ?? null;

  const assetQuery = useFixedAsset(assetId);
  const scheduleQuery = useSchedule(assetId);
  const generateSchedule = useGenerateSchedule();
  const postDotation = usePostDotation();

  const schedule = scheduleQuery.data ?? NO_SCHEDULE;

  const [generateError, setGenerateError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);

  async function handleGenerate() {
    if (!assetId) return;
    setGenerateError(null);
    try {
      await generateSchedule.mutateAsync(assetId);
    } catch (error) {
      setGenerateError(
        error instanceof ApiError ? error.message : 'Le calcul du plan a échoué.',
      );
    }
  }

  async function handlePost(entryId: string, fiscalYearLabel: string, amount: string) {
    const asset = assetQuery.data;
    if (!asset) return;
    if (
      !window.confirm(
        `Comptabiliser la dotation ${formatMoneyFr(amount)} pour l'exercice « ${fiscalYearLabel} » ? ` +
          `Une écriture sera créée et validée immédiatement (débit compte de dotation / crédit ` +
          `compte d'amortissement de « ${asset.label} »). Cette écriture sera définitive : une ` +
          'correction éventuelle passera par une contre-passation.',
      )
    ) {
      return;
    }
    setPostError(null);
    setPostSuccess(null);
    setPostingId(entryId);
    try {
      const posted = await postDotation.mutateAsync(entryId);
      setPostSuccess(
        `Dotation comptabilisée (écriture n°${posted.postedEcritureNum ?? '?'}) pour « ${fiscalYearLabel} ».`,
      );
    } catch (error) {
      setPostError(error instanceof ApiError ? error.message : 'La comptabilisation a échoué.');
    } finally {
      setPostingId(null);
    }
  }

  if (assetQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  if (!assetQuery.data) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Immobilisation introuvable.
      </div>
    );
  }

  const asset = assetQuery.data;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
      <div>
        <Link to="/immobilisations" className="text-[12.5px] text-ink-faint hover:text-ink">
          ← Immobilisations
        </Link>
        <h1 className="mt-1 text-[20px] font-semibold tracking-tight text-ink">{asset.label}</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Mise en service le {formatDate(asset.serviceStartDate)} — {asset.usefulLifeYears} an
          {asset.usefulLifeYears > 1 ? 's' : ''}, méthode linéaire.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Valeur brute" value={asset.valeurBrute} />
        <SummaryCard label="Amortissements cumulés" value={asset.amortissementsCumules} muted />
        <SummaryCard label="VNC" value={asset.vnc} emphasize />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-ink">Plan d'amortissement</h2>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generateSchedule.isPending}
            className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generateSchedule.isPending
              ? 'Calcul…'
              : schedule.length === 0
                ? 'Générer le plan'
                : 'Recalculer le plan'}
          </button>
        </div>

        {generateError && (
          <div className="flex items-center justify-between rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
            <span>{generateError}</span>
            <button type="button" onClick={() => setGenerateError(null)} className="font-medium">
              Fermer
            </button>
          </div>
        )}
        {postError && (
          <div className="flex items-center justify-between rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
            <span>{postError}</span>
            <button type="button" onClick={() => setPostError(null)} className="font-medium">
              Fermer
            </button>
          </div>
        )}
        {postSuccess && (
          <div className="flex items-center justify-between rounded-md bg-positive-soft px-4 py-2.5 text-[13px] text-positive">
            <span>{postSuccess}</span>
            <button type="button" onClick={() => setPostSuccess(null)} className="font-medium">
              Fermer
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Exercice</th>
                <th className="px-4 py-2.5 text-right font-semibold">Dotation</th>
                <th className="px-4 py-2.5 font-semibold">Statut</th>
                <th className="w-40 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {schedule.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-[13px] text-ink-faint">
                    Aucun plan calculé — cliquez sur « Générer le plan ».
                  </td>
                </tr>
              ) : (
                schedule.map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{line.fiscalYearLabel}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                      {formatMoneyFr(line.amount)}
                    </td>
                    <td className="px-4 py-2.5">
                      {line.postedEcritureId ? (
                        <span className="inline-flex items-center rounded-full bg-bg px-2 py-0.5 text-[11.5px] font-medium text-ink-muted">
                          Comptabilisé
                          {line.postedEcritureNum ? ` (n°${line.postedEcritureNum})` : ''}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] font-medium text-warning">
                          À comptabiliser
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!line.postedEcritureId && (
                        <button
                          type="button"
                          onClick={() => void handlePost(line.id, line.fiscalYearLabel, line.amount)}
                          disabled={postingId === line.id}
                          className="rounded px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {postingId === line.id ? 'Comptabilisation…' : 'Comptabiliser la dotation'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  muted,
  emphasize,
}: {
  label: string;
  value: string;
  muted?: boolean;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div
        className={[
          'mt-1 text-[18px] font-semibold tabular-nums',
          emphasize ? 'text-accent' : muted ? 'text-ink-muted' : 'text-ink',
        ].join(' ')}
      >
        {formatMoneyFr(value)}
      </div>
    </div>
  );
}
