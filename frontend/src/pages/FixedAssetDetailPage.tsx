import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useAccounts,
  useDisposeFixedAsset,
  useFixedAsset,
  useGenerateSchedule,
  usePostDotation,
  useSchedule,
} from '../api/queries';
import type { CessionFixedAssetDto } from '../api/dto';
import { ApiError } from '../api/client';
import { formatMoneyFr, normalizeMoneyInput, sanitizeAmountBuffer, subtractMoneyStrings } from '../lib/money';
import { AccountCombobox } from '../components/journal/AccountCombobox';

const NO_SCHEDULE: never[] = [];
const NO_ACCOUNTS: never[] = [];

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

interface DisposalDraft {
  cessionDate: string;
  cessionPrice: string;
  compteReglementId: string | null;
}

function emptyDisposalDraft(defaultCompteReglementId: string | null): DisposalDraft {
  return { cessionDate: '', cessionPrice: '', compteReglementId: defaultCompteReglementId };
}

export function FixedAssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const assetId = id ?? null;

  const assetQuery = useFixedAsset(assetId);
  const scheduleQuery = useSchedule(assetId);
  const accountsQuery = useAccounts();
  const generateSchedule = useGenerateSchedule();
  const postDotation = usePostDotation();
  const disposeFixedAsset = useDisposeFixedAsset();

  const schedule = scheduleQuery.data ?? NO_SCHEDULE;
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;

  // Per assertValidCompteReglement on the backend: a 462-prefixed créance
  // account or any class-5 (financier) account, nothing else.
  const compteReglementAccounts = useMemo(
    () => accounts.filter((a) => !a.isAuxiliary && (a.number.startsWith('462') || a.pcgClass === 5)),
    [accounts],
  );
  const default462Id = useMemo(
    () => accounts.find((a) => a.number === '462000')?.id ?? null,
    [accounts],
  );

  const [generateError, setGenerateError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);

  const [isDisposing, setIsDisposing] = useState(false);
  const [disposalDraft, setDisposalDraft] = useState<DisposalDraft>(emptyDisposalDraft(null));
  const [disposeError, setDisposeError] = useState<string | null>(null);
  const [disposeSuccess, setDisposeSuccess] = useState<string | null>(null);

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

  const normalizedCessionPrice = normalizeMoneyInput(disposalDraft.cessionPrice);
  const cessionPriceIsValid = /^\d+(\.\d{1,2})?$/.test(normalizedCessionPrice);
  const canDispose =
    disposalDraft.cessionDate !== '' && cessionPriceIsValid && Boolean(disposalDraft.compteReglementId);

  async function handleDispose() {
    const asset = assetQuery.data;
    if (!assetId || !asset || !canDispose || !disposalDraft.compteReglementId) return;
    const compte = accounts.find((a) => a.id === disposalDraft.compteReglementId);
    if (
      !window.confirm(
        `Céder « ${asset.label} » le ${formatDate(disposalDraft.cessionDate)} pour ` +
          `${formatMoneyFr(normalizedCessionPrice)} ? Si l'exercice de cession n'est pas encore ` +
          "entièrement comptabilisé, une dotation prorata temporis sera d'abord créée et validée, " +
          "puis l'écriture de cession sera créée et validée immédiatement (sortie de la valeur " +
          'brute et des amortissements cumulés de « ' +
          `${asset.label} », réception du prix de cession sur le compte « ${compte ? `${compte.number} — ${compte.label}` : ''} », ` +
          'et constatation de la plus ou moins-value). Ces écritures seront définitives : une ' +
          'correction éventuelle passera par une contre-passation.',
      )
    ) {
      return;
    }
    setDisposeError(null);
    setDisposeSuccess(null);
    const dto: CessionFixedAssetDto = {
      cessionDate: disposalDraft.cessionDate,
      cessionPrice: normalizedCessionPrice,
      compteReglementId: disposalDraft.compteReglementId,
    };
    try {
      const result = await disposeFixedAsset.mutateAsync({ fixedAssetId: assetId, dto });
      const sign = result.plusOuMoinsValue.startsWith('-') ? 'Moins-value' : 'Plus-value';
      setDisposeSuccess(
        `Cession comptabilisée (écriture n°${result.cessionEcritureNum}` +
          (result.finalDotationEcritureNum
            ? `, dotation finale n°${result.finalDotationEcritureNum}`
            : '') +
          `). ${sign} de ${formatMoneyFr(result.plusOuMoinsValue)}.`,
      );
      setIsDisposing(false);
      setDisposalDraft(emptyDisposalDraft(default462Id));
    } catch (error) {
      setDisposeError(error instanceof ApiError ? error.message : 'La cession a échoué.');
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
  const isDisposed = Boolean(asset.cessionDate);
  const plusOuMoinsValue = isDisposed ? subtractMoneyStrings(asset.cessionPrice ?? '0.00', asset.vnc) : null;
  const isMoinsValue = plusOuMoinsValue?.startsWith('-') ?? false;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
      <div className="flex items-start justify-between gap-4">
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
        {!isDisposed && (
          <button
            type="button"
            onClick={() => {
              setIsDisposing(true);
              setDisposeError(null);
              setDisposalDraft((d) => ({ ...d, compteReglementId: d.compteReglementId ?? default462Id }));
            }}
            disabled={isDisposing}
            className="shrink-0 rounded-md border border-border px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            Céder l'immobilisation
          </button>
        )}
      </div>

      {isDisposed && plusOuMoinsValue && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg px-4 py-3 text-[13px]">
          <span className="inline-flex items-center rounded-full bg-border-strong px-2 py-0.5 text-[11.5px] font-medium text-ink">
            Cédée
          </span>
          <span className="text-ink-muted">
            le {formatDate(asset.cessionDate!)} pour {formatMoneyFr(asset.cessionPrice ?? '0.00')}
          </span>
          <span className={isMoinsValue ? 'font-medium text-negative' : 'font-medium text-positive'}>
            {isMoinsValue ? 'Moins-value' : 'Plus-value'} de {formatMoneyFr(plusOuMoinsValue)}
          </span>
        </div>
      )}

      {isDisposing && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Date de cession">
              <input
                autoFocus
                type="date"
                value={disposalDraft.cessionDate}
                onChange={(e) =>
                  setDisposalDraft((d) => ({ ...d, cessionDate: e.target.value }))
                }
                className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
              />
            </Field>
            <Field label="Prix de cession">
              <input
                type="text"
                inputMode="decimal"
                value={disposalDraft.cessionPrice}
                onChange={(e) =>
                  setDisposalDraft((d) => ({ ...d, cessionPrice: sanitizeAmountBuffer(e.target.value) }))
                }
                placeholder="21000,00"
                className="w-32 rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <Field label="Compte de règlement" grow>
              <div className="rounded-md border border-border bg-surface focus-within:border-accent">
                <AccountCombobox
                  accounts={compteReglementAccounts}
                  value={disposalDraft.compteReglementId}
                  onSelect={(id) => setDisposalDraft((d) => ({ ...d, compteReglementId: id }))}
                  placeholder="N° compte (462 ou classe 5)"
                />
              </div>
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsDisposing(false);
                setDisposalDraft(emptyDisposalDraft(default462Id));
                setDisposeError(null);
              }}
              className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={!canDispose || disposeFixedAsset.isPending}
              onClick={() => void handleDispose()}
              className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {disposeFixedAsset.isPending ? 'Cession…' : 'Céder'}
            </button>
          </div>
          {disposeError && <p className="text-right text-[12.5px] text-negative">{disposeError}</p>}
        </div>
      )}

      {disposeSuccess && (
        <div className="flex items-center justify-between rounded-md bg-positive-soft px-4 py-2.5 text-[13px] text-positive">
          <span>{disposeSuccess}</span>
          <button type="button" onClick={() => setDisposeSuccess(null)} className="font-medium">
            Fermer
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Valeur brute" value={asset.valeurBrute} />
        <SummaryCard label="Amortissements cumulés" value={asset.amortissementsCumules} muted />
        <SummaryCard label="VNC" value={asset.vnc} emphasize />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-ink">Plan d'amortissement</h2>
          {isDisposed ? (
            <span className="text-[12.5px] text-ink-faint">Plan clos — immobilisation cédée.</span>
          ) : (
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
          )}
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
                      {!line.postedEcritureId && !isDisposed && (
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

function Field({
  label,
  children,
  grow,
}: {
  label: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <label className={grow ? 'flex flex-1 flex-col gap-1' : 'flex flex-col gap-1'}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
