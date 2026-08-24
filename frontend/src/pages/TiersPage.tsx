import { useMemo, useState } from 'react';
import { useAccounts } from '../api/queries';
import { isAuxiliaryBearingAccount } from '../lib/accounts';
import { CollectifTiersCard } from '../components/tiers/CollectifTiersCard';

const NO_ACCOUNTS: never[] = [];

export function TiersPage() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;
  const [search, setSearch] = useState('');

  const collectifs = useMemo(
    () =>
      accounts
        .filter((a) => !a.isAuxiliary && isAuxiliaryBearingAccount(a))
        .sort((a, b) => a.number.localeCompare(b.number)),
    [accounts],
  );

  const needle = search.trim().toLowerCase();
  const tiersByCollectif = useMemo(() => {
    const map = new Map<string, typeof accounts>();
    for (const collectif of collectifs) {
      const tiers = accounts
        .filter((a) => a.parentId === collectif.id)
        .filter(
          (t) =>
            needle === '' ||
            t.number.toLowerCase().includes(needle) ||
            t.label.toLowerCase().includes(needle),
        )
        .sort((a, b) => a.number.localeCompare(b.number));
      map.set(collectif.id, tiers);
    }
    return map;
  }, [accounts, collectifs, needle]);

  // While searching, a collectif with no matching tiers (and not itself
  // matching, e.g. by its own number/label) is hidden rather than shown
  // empty — pure display filtering over the already-fetched accounts.
  const visibleCollectifs = collectifs.filter((c) => {
    if (needle === '') return true;
    const selfMatches =
      c.number.toLowerCase().includes(needle) || c.label.toLowerCase().includes(needle);
    return selfMatches || (tiersByCollectif.get(c.id)?.length ?? 0) > 0;
  });

  if (accountsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Tiers</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Comptes auxiliaires (fournisseurs, clients, associés) rattachés aux comptes collectifs
            401, 411 et 455.
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un tiers — numéro ou nom…"
          className="w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </header>

      {needle !== '' && visibleCollectifs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
          Aucun tiers ne correspond à « {search} ».
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {visibleCollectifs.map((collectif) => (
            <CollectifTiersCard
              key={collectif.id}
              collectif={collectif}
              tiers={
                needle === ''
                  ? accounts
                      .filter((a) => a.parentId === collectif.id)
                      .sort((a, b) => a.number.localeCompare(b.number))
                  : (tiersByCollectif.get(collectif.id) ?? [])
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
