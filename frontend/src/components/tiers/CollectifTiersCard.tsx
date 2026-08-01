import { useState } from 'react';
import type { Account } from '../../api/types';
import { useCreateTiers, useRenameAccount } from '../../api/queries';
import { ApiError } from '../../api/client';

export function CollectifTiersCard({
  collectif,
  tiers,
}: {
  collectif: Account;
  tiers: Account[];
}) {
  const createTiers = useCreateTiers();
  const renameAccount = useRenameAccount();

  const [isCreating, setIsCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (newLabel.trim() === '') return;
    setError(null);
    try {
      await createTiers.mutateAsync({ parentId: collectif.id, dto: { label: newLabel.trim() } });
      setNewLabel('');
      setIsCreating(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La création a échoué.');
    }
  }

  async function handleRename(id: string) {
    if (editLabel.trim() === '') return;
    setError(null);
    try {
      await renameAccount.mutateAsync({ id, dto: { label: editLabel.trim() } });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Le renommage a échoué.');
    }
  }

  function startEditing(t: Account) {
    setEditingId(t.id);
    setEditLabel(t.label);
    setError(null);
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-[14px] font-semibold text-ink">
          <span className="tabular-nums text-ink-muted">{collectif.number}</span>
          {' — '}
          {collectif.label}
        </h2>
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
            setError(null);
          }}
          className="rounded-md px-2.5 py-1 text-[12.5px] font-medium text-accent hover:bg-accent-soft"
        >
          + Nouveau tiers
        </button>
      </div>

      {error && (
        <div className="border-b border-negative-soft bg-negative-soft px-5 py-2 text-[12.5px] text-negative">
          {error}
        </div>
      )}

      {tiers.length === 0 && !isCreating ? (
        <p className="px-5 py-6 text-center text-[13px] text-ink-faint">
          Aucun tiers sous ce compte collectif.
        </p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="w-28 px-5 py-2 font-semibold">N°</th>
              <th className="px-5 py-2 font-semibold">Libellé</th>
              <th className="w-24 px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-b-0">
                <td className="px-5 py-2 tabular-nums text-ink-muted">{t.number}</td>
                <td className="px-5 py-2">
                  {editingId === t.id ? (
                    <input
                      autoFocus
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRename(t.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="w-full rounded-md border border-border px-2 py-1 text-[13px] text-ink outline-none focus:border-accent"
                    />
                  ) : (
                    <span className="text-ink">{t.label}</span>
                  )}
                </td>
                <td className="px-5 py-2 text-right">
                  {editingId === t.id ? (
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void handleRename(t.id)}
                        className="rounded px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft"
                      >
                        Enregistrer
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded px-2 py-1 text-[12px] font-medium text-ink-muted hover:bg-bg"
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditing(t)}
                      className="rounded px-2 py-1 text-[12px] font-medium text-ink-muted hover:bg-bg hover:text-ink"
                    >
                      Renommer
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {isCreating && (
              <tr className="border-b border-border last:border-b-0 bg-accent-soft/40">
                <td className="px-5 py-2 tabular-nums text-ink-faint">—</td>
                <td className="px-5 py-2">
                  <input
                    autoFocus
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreate();
                      if (e.key === 'Escape') {
                        setIsCreating(false);
                        setNewLabel('');
                      }
                    }}
                    placeholder="Nom du tiers"
                    className="w-full rounded-md border border-border px-2 py-1 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                  />
                </td>
                <td className="px-5 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void handleCreate()}
                      disabled={newLabel.trim() === ''}
                      className="rounded px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-ink-faint"
                    >
                      Créer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreating(false);
                        setNewLabel('');
                      }}
                      className="rounded px-2 py-1 text-[12px] font-medium text-ink-muted hover:bg-bg"
                    >
                      Annuler
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tiers.length === 0 && isCreating && (
        <p className="px-5 pb-4 text-[12px] text-ink-faint">
          Le numéro sera attribué automatiquement ({collectif.number.slice(0, 3)}001).
        </p>
      )}
    </section>
  );
}
