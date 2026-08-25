import { useMemo, useState } from 'react';
import type { Account, Ecriture } from '../../api/types';
import { addMoneyStrings, compareMoneyStrings, formatMoneyFr } from '../../lib/money';
import { StatusBadge } from './StatusBadge';
import { DocumentIndicator } from './DocumentViewer';

function totalOf(ecriture: Ecriture): string {
  return ecriture.lignes.reduce((sum, ligne) => addMoneyStrings(sum, ligne.debit), '0.00');
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

type StatusFilter = 'all' | 'draft' | 'validated';
type SortKey = 'date' | 'montant';

function matchesSearch(
  ecriture: Ecriture,
  needle: string,
  accountsById: Map<string, Account>,
): boolean {
  const haystack = [
    ecriture.libelle,
    ecriture.pieceRef ?? '',
    ecriture.ecritureNum ?? '',
    ...ecriture.lignes.flatMap((l) => {
      const account = accountsById.get(l.compteId);
      return account ? [account.number, account.label] : [];
    }),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function EcrituresList({
  ecritures,
  selectedId,
  accounts,
  onSelect,
  onDelete,
  onValidate,
  onReverse,
}: {
  ecritures: Ecriture[];
  selectedId: string | null;
  /** Resolves each line's compteId to its number/label for search — the
   * same already-fetched accounts list every other screen in this app
   * uses, no new query. */
  accounts: Account[];
  onSelect: (ecriture: Ecriture) => void;
  onDelete: (ecriture: Ecriture) => void;
  onValidate: (ecriture: Ecriture) => void;
  onReverse: (ecriture: Ecriture) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let result = ecritures;
    if (needle !== '') result = result.filter((e) => matchesSearch(e, needle, accountsById));
    if (statusFilter !== 'all') {
      result = result.filter((e) =>
        statusFilter === 'validated' ? Boolean(e.validatedAt) : !e.validatedAt,
      );
    }
    result = [...result].sort((a, b) => {
      const cmp =
        sortKey === 'date'
          ? a.ecritureDate.localeCompare(b.ecritureDate)
          : compareMoneyStrings(totalOf(a), totalOf(b));
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [ecritures, search, statusFilter, sortKey, sortAsc, accountsById]);

  const hasFilters = search.trim() !== '' || statusFilter !== 'all';

  if (ecritures.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
        Aucune écriture pour ce journal et cet exercice.
      </div>
    );
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((asc) => !asc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher — libellé, pièce, n°, compte…"
          className="w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
        >
          <option value="all">Tous statuts</option>
          <option value="draft">Brouillons</option>
          <option value="validated">Validées</option>
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
            }}
            className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-ink-muted hover:bg-bg"
          >
            Réinitialiser
          </button>
        )}
        <span className="ml-auto text-[12px] text-ink-faint">
          {filtered.length} écriture{filtered.length !== 1 ? 's' : ''}
          {hasFilters ? ` sur ${ecritures.length}` : ''}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
          Aucun résultat pour ces filtres.
        </div>
      ) : (
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5 font-semibold">N°</th>
            <th
              onClick={() => toggleSort('date')}
              className="cursor-pointer select-none px-4 py-2.5 font-semibold hover:text-ink"
            >
              Date {sortKey === 'date' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th className="px-4 py-2.5 font-semibold">Pièce</th>
            <th className="px-4 py-2.5 font-semibold">Libellé</th>
            <th
              onClick={() => toggleSort('montant')}
              className="cursor-pointer select-none px-4 py-2.5 text-right font-semibold hover:text-ink"
            >
              Montant {sortKey === 'montant' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th className="px-4 py-2.5 font-semibold">Statut</th>
            <th className="w-28 px-2 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {filtered.map((ecriture) => {
            const isSelected = ecriture.id === selectedId;
            return (
              <tr
                key={ecriture.id}
                onClick={() => onSelect(ecriture)}
                className={[
                  'cursor-pointer border-b border-border last:border-b-0',
                  isSelected ? 'bg-accent-soft' : 'hover:bg-bg',
                ].join(' ')}
              >
                <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                  {ecriture.ecritureNum ?? '—'}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-ink">
                  {formatDate(ecriture.ecritureDate)}
                </td>
                <td className="px-4 py-2.5 text-ink-muted">
                  <div className="flex items-center gap-1.5">
                    <span>{ecriture.pieceRef ?? '—'}</span>
                    <DocumentIndicator
                      ecritureId={ecriture.id}
                      documentCount={ecriture.documentCount}
                    />
                  </div>
                </td>
                <td className="max-w-xs truncate px-4 py-2.5 text-ink">{ecriture.libelle}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                  {formatMoneyFr(totalOf(ecriture))}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge validated={Boolean(ecriture.validatedAt)} />
                </td>
                <td className="px-1 text-right">
                  {ecriture.validatedAt ? (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReverse(ecriture);
                        }}
                        className="rounded px-2 py-1 text-[12px] font-medium text-ink-muted hover:bg-accent-soft hover:text-accent"
                      >
                        Contre-passer
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onValidate(ecriture);
                        }}
                        className="rounded px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft"
                      >
                        Valider
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(ecriture);
                        }}
                        aria-label="Supprimer l'écriture"
                        className="rounded p-1 text-ink-faint hover:bg-negative-soft hover:text-negative"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <path
                            d="M3 3.5h8M5.5 3.5v-1h3v1M4.5 3.5 5 11h4l.5-7.5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      )}
    </div>
  );
}
