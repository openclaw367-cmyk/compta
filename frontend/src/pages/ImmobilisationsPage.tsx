import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccounts, useCreateFixedAsset, useFixedAssets } from '../api/queries';
import type { CreateFixedAssetDto } from '../api/dto';
import { ApiError } from '../api/client';
import { formatMoneyFr, normalizeMoneyInput, sanitizeAmountBuffer } from '../lib/money';
import { AccountCombobox } from '../components/journal/AccountCombobox';

const NO_ASSETS: never[] = [];
const NO_ACCOUNTS: never[] = [];

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

interface Draft {
  label: string;
  accountId: string | null;
  depreciationAccountId: string | null;
  expenseAccountId: string | null;
  acquisitionDate: string;
  serviceStartDate: string;
  acquisitionValue: string;
  residualValue: string;
  usefulLifeYears: string;
}

function emptyDraft(): Draft {
  return {
    label: '',
    accountId: null,
    depreciationAccountId: null,
    expenseAccountId: null,
    acquisitionDate: '',
    serviceStartDate: '',
    acquisitionValue: '',
    residualValue: '',
    usefulLifeYears: '',
  };
}

export function ImmobilisationsPage() {
  const assetsQuery = useFixedAssets();
  const accountsQuery = useAccounts();
  const createFixedAsset = useCreateFixedAsset();

  const assets = assetsQuery.data ?? NO_ASSETS;
  const sorted = [...assets].sort((a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate));
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;

  // Pre-filtered per the account-triplet convention (see CLAUDE.md /
  // assertValidAccountTriplet on the backend): immobilisation accounts are
  // class 2 excluding the 28x/29x contra-accounts, amortissements are
  // prefixed 28, dotations expense accounts are prefixed 681.
  const assetAccounts = useMemo(
    () => accounts.filter((a) => !a.isAuxiliary && a.pcgClass === 2 && !/^2[89]/.test(a.number)),
    [accounts],
  );
  const depreciationAccounts = useMemo(
    () => accounts.filter((a) => !a.isAuxiliary && a.number.startsWith('28')),
    [accounts],
  );
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => !a.isAuxiliary && a.number.startsWith('681')),
    [accounts],
  );

  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [createError, setCreateError] = useState<string | null>(null);

  const normalizedAcquisitionValue = normalizeMoneyInput(draft.acquisitionValue);
  const normalizedResidualValue = normalizeMoneyInput(draft.residualValue || '0.00');
  const acquisitionValueIsValid = /^\d+(\.\d{1,2})?$/.test(normalizedAcquisitionValue);
  const residualValueIsValid =
    draft.residualValue === '' || /^\d+(\.\d{1,2})?$/.test(normalizedResidualValue);
  const usefulLifeYearsIsValid = /^\d+$/.test(draft.usefulLifeYears) && Number(draft.usefulLifeYears) >= 1;

  const canCreate =
    draft.label.trim() !== '' &&
    Boolean(draft.accountId) &&
    Boolean(draft.depreciationAccountId) &&
    Boolean(draft.expenseAccountId) &&
    draft.acquisitionDate !== '' &&
    draft.serviceStartDate !== '' &&
    acquisitionValueIsValid &&
    residualValueIsValid &&
    usefulLifeYearsIsValid;

  async function handleCreate() {
    if (!canCreate) return;
    setCreateError(null);
    const dto: CreateFixedAssetDto = {
      label: draft.label.trim(),
      accountId: draft.accountId!,
      depreciationAccountId: draft.depreciationAccountId!,
      expenseAccountId: draft.expenseAccountId!,
      acquisitionDate: draft.acquisitionDate,
      serviceStartDate: draft.serviceStartDate,
      acquisitionValue: normalizedAcquisitionValue,
      residualValue: draft.residualValue === '' ? undefined : normalizedResidualValue,
      usefulLifeYears: Number(draft.usefulLifeYears),
      method: 'LINEAR',
    };
    try {
      await createFixedAsset.mutateAsync(dto);
      setDraft(emptyDraft());
      setIsCreating(false);
    } catch (error) {
      setCreateError(error instanceof ApiError ? error.message : 'La création a échoué.');
    }
  }

  if (assetsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Immobilisations</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Immobilisations et plan d'amortissement.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
            setCreateError(null);
          }}
          disabled={isCreating}
          className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
        >
          + Nouvelle immobilisation
        </button>
      </header>

      {isCreating && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Désignation" grow>
              <input
                autoFocus
                type="text"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Ordinateur portable"
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <Field label="Date d'acquisition">
              <input
                type="date"
                value={draft.acquisitionDate}
                onChange={(e) => setDraft((d) => ({ ...d, acquisitionDate: e.target.value }))}
                className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
              />
            </Field>
            <Field label="Mise en service">
              <input
                type="date"
                value={draft.serviceStartDate}
                onChange={(e) => setDraft((d) => ({ ...d, serviceStartDate: e.target.value }))}
                className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <Field label="Valeur d'acquisition">
              <input
                type="text"
                inputMode="decimal"
                value={draft.acquisitionValue}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, acquisitionValue: sanitizeAmountBuffer(e.target.value) }))
                }
                placeholder="1200,00"
                className="w-32 rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <Field label="Valeur résiduelle">
              <input
                type="text"
                inputMode="decimal"
                value={draft.residualValue}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, residualValue: sanitizeAmountBuffer(e.target.value) }))
                }
                placeholder="0,00"
                className="w-32 rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <Field label="Durée (années)">
              <input
                type="number"
                min={1}
                step={1}
                value={draft.usefulLifeYears}
                onChange={(e) => setDraft((d) => ({ ...d, usefulLifeYears: e.target.value }))}
                placeholder="3"
                className="w-20 rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <Field label="Mode">
              <select
                disabled
                value="LINEAR"
                title="Seul le mode linéaire est implémenté — voir CLAUDE.md."
                className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-ink-faint outline-none"
              >
                <option value="LINEAR">Linéaire</option>
                <option value="DECLINING">Dégressif (non implémenté)</option>
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <Field label="Compte d'immobilisation" grow>
              <div className="rounded-md border border-border bg-surface focus-within:border-accent">
                <AccountCombobox
                  accounts={assetAccounts}
                  value={draft.accountId}
                  onSelect={(id) => setDraft((d) => ({ ...d, accountId: id }))}
                  placeholder="N° compte (classe 2)"
                />
              </div>
            </Field>
            <Field label="Compte d'amortissement" grow>
              <div className="rounded-md border border-border bg-surface focus-within:border-accent">
                <AccountCombobox
                  accounts={depreciationAccounts}
                  value={draft.depreciationAccountId}
                  onSelect={(id) => setDraft((d) => ({ ...d, depreciationAccountId: id }))}
                  placeholder="N° compte (28x)"
                />
              </div>
            </Field>
            <Field label="Compte de dotation" grow>
              <div className="rounded-md border border-border bg-surface focus-within:border-accent">
                <AccountCombobox
                  accounts={expenseAccounts}
                  value={draft.expenseAccountId}
                  onSelect={(id) => setDraft((d) => ({ ...d, expenseAccountId: id }))}
                  placeholder="N° compte (681x)"
                />
              </div>
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setDraft(emptyDraft());
                setCreateError(null);
              }}
              className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={!canCreate || createFixedAsset.isPending}
              onClick={() => void handleCreate()}
              className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {createFixedAsset.isPending ? 'Création…' : 'Créer'}
            </button>
          </div>
          {createError && <p className="text-right text-[12.5px] text-negative">{createError}</p>}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Désignation</th>
              <th className="px-4 py-2.5 font-semibold">Mise en service</th>
              <th className="px-4 py-2.5 text-right font-semibold">Valeur brute</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amort. cumulés</th>
              <th className="px-4 py-2.5 text-right font-semibold">VNC</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-ink-faint">
                  Aucune immobilisation — créez-en une pour commencer.
                </td>
              </tr>
            ) : (
              sorted.map((asset) => (
                <tr key={asset.id} className="border-b border-border last:border-b-0 hover:bg-bg">
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/immobilisations/${asset.id}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {asset.label}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                    {formatDate(asset.serviceStartDate)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                    {formatMoneyFr(asset.valeurBrute)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                    {formatMoneyFr(asset.amortissementsCumules)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">
                    {formatMoneyFr(asset.vnc)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
