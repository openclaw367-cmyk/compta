import { useMemo } from 'react';
import { useAccounts } from '../api/queries';
import { isAuxiliaryBearingAccount } from '../lib/accounts';
import { CollectifTiersCard } from '../components/tiers/CollectifTiersCard';

const NO_ACCOUNTS: never[] = [];

export function TiersPage() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;

  const collectifs = useMemo(
    () =>
      accounts
        .filter((a) => !a.isAuxiliary && isAuxiliaryBearingAccount(a))
        .sort((a, b) => a.number.localeCompare(b.number)),
    [accounts],
  );

  if (accountsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Tiers</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Comptes auxiliaires (fournisseurs, clients) rattachés aux comptes collectifs 401 et
          411.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        {collectifs.map((collectif) => (
          <CollectifTiersCard
            key={collectif.id}
            collectif={collectif}
            tiers={accounts
              .filter((a) => a.parentId === collectif.id)
              .sort((a, b) => a.number.localeCompare(b.number))}
          />
        ))}
      </div>
    </div>
  );
}
