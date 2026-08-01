import { useMemo, useState } from 'react';
import { useAccounts, useCreateAccount, useCreateJournal, useJournals } from '../api/queries';
import type { CreateAccountDto, CreateJournalDto } from '../api/dto';
import { ApiError } from '../api/client';
import type { Journal } from '../api/types';

const NO_JOURNALS: never[] = [];
const NO_ACCOUNTS: never[] = [];

const JOURNAL_TYPE_LABEL: Record<Journal['type'], string> = {
  ACHATS: 'Achats',
  VENTES: 'Ventes',
  BANQUE: 'Banque',
  CAISSE: 'Caisse',
  OPERATIONS_DIVERSES: 'Opérations diverses',
  A_NOUVEAU: 'À-nouveaux',
};

const PCG_CLASS_LABEL: Record<number, string> = {
  1: 'Classe 1 — Capitaux',
  2: 'Classe 2 — Immobilisations',
  3: 'Classe 3 — Stocks',
  4: 'Classe 4 — Tiers',
  5: 'Classe 5 — Financiers',
  6: 'Classe 6 — Charges',
  7: 'Classe 7 — Produits',
  8: 'Classe 8 — Comptes spéciaux',
};

export function AccountsJournalsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Comptes & journaux</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Journaux comptables et plan comptable de la société.
        </p>
      </header>

      <JournalsSection />
      <AccountsSection />
    </div>
  );
}

function JournalsSection() {
  const journalsQuery = useJournals();
  const createJournal = useCreateJournal();

  const journals = journalsQuery.data ?? NO_JOURNALS;
  const sorted = [...journals].sort((a, b) => a.code.localeCompare(b.code));

  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<CreateJournalDto>({
    code: '',
    label: '',
    type: 'OPERATIONS_DIVERSES',
  });
  const [error, setError] = useState<string | null>(null);

  const canCreate = draft.code.trim() !== '' && draft.label.trim() !== '';

  async function handleCreate() {
    if (!canCreate) return;
    setError(null);
    try {
      await createJournal.mutateAsync({
        code: draft.code.trim().toUpperCase(),
        label: draft.label.trim(),
        type: draft.type,
      });
      setDraft({ code: '', label: '', type: 'OPERATIONS_DIVERSES' });
      setIsCreating(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La création a échoué.');
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink">Journaux</h2>
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
            setError(null);
          }}
          disabled={isCreating}
          className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
        >
          + Nouveau journal
        </button>
      </div>

      {isCreating && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Code">
              <input
                autoFocus
                type="text"
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
                placeholder="CA"
                className="w-20 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] uppercase text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <Field label="Libellé" grow>
              <input
                type="text"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Journal de caisse"
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <Field label="Type">
              <select
                value={draft.type}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, type: e.target.value as Journal['type'] }))
                }
                className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
              >
                {Object.entries(JOURNAL_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setError(null);
                }}
                className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!canCreate || createJournal.isPending}
                onClick={() => void handleCreate()}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
              >
                {createJournal.isPending ? 'Création…' : 'Créer'}
              </button>
            </div>
          </div>
          {error && <p className="text-[12.5px] text-negative">{error}</p>}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="w-20 px-4 py-2.5 font-semibold">Code</th>
              <th className="px-4 py-2.5 font-semibold">Libellé</th>
              <th className="px-4 py-2.5 font-semibold">Type</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((journal) => (
              <tr key={journal.id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2.5 font-medium tabular-nums text-ink">{journal.code}</td>
                <td className="px-4 py-2.5 text-ink">{journal.label}</td>
                <td className="px-4 py-2.5 text-ink-muted">{JOURNAL_TYPE_LABEL[journal.type]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AccountsSection() {
  const accountsQuery = useAccounts();
  const createAccount = useCreateAccount();

  const accounts = accountsQuery.data ?? NO_ACCOUNTS;
  const baseAccounts = useMemo(() => accounts.filter((a) => !a.isAuxiliary), [accounts]);

  const byClass = useMemo(() => {
    const groups = new Map<number, typeof baseAccounts>();
    for (const account of baseAccounts) {
      const group = groups.get(account.pcgClass) ?? [];
      group.push(account);
      groups.set(account.pcgClass, group);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.number.localeCompare(b.number));
    }
    return groups;
  }, [baseAccounts]);

  const [expandedClass, setExpandedClass] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<CreateAccountDto>({ number: '', label: '' });
  const [error, setError] = useState<string | null>(null);

  const canCreate = /^[1-8]/.test(draft.number.trim()) && draft.label.trim() !== '';

  async function handleCreate() {
    if (!canCreate) return;
    setError(null);
    try {
      const created = await createAccount.mutateAsync({
        number: draft.number.trim(),
        label: draft.label.trim(),
      });
      setDraft({ number: '', label: '' });
      setIsCreating(false);
      setExpandedClass(created.pcgClass);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La création a échoué.');
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink">Plan comptable</h2>
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
            setError(null);
          }}
          disabled={isCreating}
          className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
        >
          + Nouveau compte
        </button>
      </div>

      {isCreating && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="N° de compte">
              <input
                autoFocus
                type="text"
                value={draft.number}
                onChange={(e) => setDraft((d) => ({ ...d, number: e.target.value }))}
                placeholder="622100"
                className="w-32 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] tabular-nums text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <Field label="Libellé" grow>
              <input
                type="text"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Honoraires"
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </Field>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setError(null);
                }}
                className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!canCreate || createAccount.isPending}
                onClick={() => void handleCreate()}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
              >
                {createAccount.isPending ? 'Création…' : 'Créer'}
              </button>
            </div>
          </div>
          <p className="text-[11.5px] text-ink-faint">
            Pour un compte auxiliaire (tiers) sous un collectif 401/411, utilisez l'écran Tiers —
            ce formulaire crée un compte de plan comptable standard.
          </p>
          {error && <p className="text-[12.5px] text-negative">{error}</p>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, i) => i + 1).map((pcgClass) => {
          const group = byClass.get(pcgClass) ?? [];
          if (group.length === 0) return null;
          const isExpanded = expandedClass === pcgClass;
          return (
            <div key={pcgClass} className="overflow-hidden rounded-lg border border-border bg-surface">
              <button
                type="button"
                onClick={() => setExpandedClass(isExpanded ? null : pcgClass)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] font-medium text-ink hover:bg-bg"
              >
                <span>{PCG_CLASS_LABEL[pcgClass]}</span>
                <span className="text-[12px] font-normal text-ink-faint">
                  {group.length} compte{group.length > 1 ? 's' : ''}
                </span>
              </button>
              {isExpanded && (
                <table className="w-full border-collapse border-t border-border text-[13px]">
                  <tbody>
                    {group.map((account) => (
                      <tr key={account.id} className="border-b border-border last:border-b-0">
                        <td className="w-32 px-4 py-2 tabular-nums text-ink-muted">
                          {account.number}
                        </td>
                        <td className="px-4 py-2 text-ink">{account.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
