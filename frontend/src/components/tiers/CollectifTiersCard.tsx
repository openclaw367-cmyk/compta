import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account } from '../../api/types';
import { useCreateTiers, useRenameAccount } from '../../api/queries';
import { useAppContext } from '../../context/appContextStore';
import { formatMoneyFr, isZeroMoney } from '../../lib/money';
import { TiersFormModal, type TiersFormValues } from './TiersFormModal';

type ModalState = { mode: 'create' } | { mode: 'edit'; account: Account } | null;

export function CollectifTiersCard({
  collectif,
  tiers,
  balanceByAccountId,
}: {
  collectif: Account;
  tiers: Account[];
  /** Each account's own trial-balance figure, keyed by id — already
   * computed elsewhere (Grand Livre), just displayed here too. May be
   * empty while the trial balance is still loading; balances then
   * simply render as "—" rather than blocking the whole card. */
  balanceByAccountId: Map<string, string>;
}) {
  const navigate = useNavigate();
  const { currentCompany } = useAppContext();
  const createTiers = useCreateTiers();
  const renameAccount = useRenameAccount();

  const [modal, setModal] = useState<ModalState>(null);

  async function handleSubmit(values: TiersFormValues) {
    if (modal?.mode === 'edit') {
      await renameAccount.mutateAsync({ id: modal.account.id, dto: values });
    } else {
      await createTiers.mutateAsync({ parentId: collectif.id, dto: values });
    }
    setModal(null);
  }

  const collectifBalance = balanceByAccountId.get(collectif.id);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[14px] font-semibold text-ink">
            <span className="tabular-nums text-ink-muted">{collectif.number}</span>
            {' — '}
            {collectif.label}
          </h2>
          {collectifBalance && !isZeroMoney(collectifBalance) && (
            <span
              className="text-[12px] tabular-nums text-ink-faint"
              title="Solde du compte collectif lui-même — mouvements non rattachés à un tiers nommé"
            >
              non ventilé : {formatMoneyFr(collectifBalance)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: 'create' })}
          className="rounded-md px-2.5 py-1 text-[12.5px] font-medium text-accent hover:bg-accent-soft"
        >
          + Nouveau tiers
        </button>
      </div>

      {tiers.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13px] text-ink-faint">
          Aucun tiers sous ce compte collectif.
        </p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="w-28 px-5 py-2 font-semibold">N°</th>
              <th className="px-5 py-2 font-semibold">Libellé</th>
              <th className="w-32 px-5 py-2 text-right font-semibold">Solde</th>
              <th className="w-24 px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => {
              const balance = balanceByAccountId.get(t.id);
              return (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/grand-livre?compte=${t.id}`)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-bg"
                >
                  <td className="px-5 py-2 tabular-nums text-ink-muted">{t.number}</td>
                  <td className="px-5 py-2">
                    <span className="text-ink">{t.label}</span>
                    {(t.addressLine || t.city) && (
                      <span className="ml-2 text-[11.5px] text-ink-faint">
                        {[t.addressLine, t.postalCode, t.city].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink">
                    {balance ? formatMoneyFr(balance) : '—'}
                  </td>
                  <td className="px-5 py-2 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ mode: 'edit', account: t });
                      }}
                      className="rounded px-2 py-1 text-[12px] font-medium text-ink-muted hover:bg-bg hover:text-ink"
                    >
                      Modifier
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {modal && (
        <TiersFormModal
          mode={modal.mode}
          account={modal.mode === 'edit' ? modal.account : null}
          collectifNumber={collectif.number}
          defaultCountryCode={currentCompany?.jurisdiction ?? 'FR'}
          onSubmit={handleSubmit}
          onClose={() => setModal(null)}
        />
      )}
    </section>
  );
}
