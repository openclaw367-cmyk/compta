import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  useAccounts,
  useConfirmMcpProposal,
  useFiscalYears,
  useJournals,
  useMcpPendingProposals,
  useRejectMcpProposal,
} from '../api/queries';
import { PendingMcpProposal } from '../api/types';
import { ApiError } from '../api/client';
import { formatMoneyFr } from '../lib/money';
import { PageSkeleton } from '../components/layout/PageSkeleton';

/**
 * The web half of the MCP confirmation flow — see CLAUDE.md "MCP
 * confirmation flow". Reached either via a confirmation link
 * (`/mcp-confirm/:id`, returned by the `propose_ecriture` MCP tool) or
 * directly from the sidebar. The `:id` param is a pure deep-link
 * anchor — this page's ONLY data source is `GET /mcp-confirmations/pending`,
 * so opening ANY of a user's own links shows the SAME full reviewable
 * stack, never just the one item the link named. There is no
 * "confirm all" action, deliberately, mirroring the batch invoice
 * queue's own decision (CLAUDE.md "Batch invoice review queue"): every
 * item requires its own explicit click on its own fully-rendered
 * content, never a blind bulk action.
 *
 * Read-only review, not an editor — unlike the in-app assistant's own
 * `ProposalCard` (which lets a human edit before confirming), this
 * page shows the REAL structured proposal exactly as `propose_ecriture`
 * built it. A bad reference inside it is rejected, not patched here;
 * fixing it is a new proposal (via MCP) or a manual entry, not an edit
 * on this page — a deliberate scope choice to keep this surface small.
 */
export function McpConfirmPage() {
  const { id: linkedId } = useParams<{ id?: string }>();
  const pending = useMcpPendingProposals();

  if (pending.isLoading) {
    return <PageSkeleton maxWidth="max-w-2xl" blocks={3} />;
  }

  if (pending.isError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-lg border border-negative bg-negative-soft px-4 py-3 text-[13px] text-negative">
          Impossible de charger les propositions en attente.
        </div>
      </div>
    );
  }

  const items = pending.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div>
        <h1 className="text-[18px] font-semibold text-ink">Propositions MCP en attente</h1>
        <p className="mt-1 text-[12.5px] text-ink-faint">
          Écritures proposées depuis votre propre session Claude (MCP) — chaque entrée ci-dessous
          est l'écriture réelle, structurée, à relire avant de la confirmer. Rien n'est enregistré
          sans votre action explicite, entrée par entrée.
        </p>
      </div>

      {items.length === 0 && (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-[13px] text-ink-faint">
          Aucune proposition en attente.
        </div>
      )}

      {items.map((item) => (
        <McpProposalCard key={item.id} item={item} highlighted={item.id === linkedId} />
      ))}
    </div>
  );
}

function McpProposalCard({
  item,
  highlighted,
}: {
  item: PendingMcpProposal;
  highlighted: boolean;
}) {
  const journals = useJournals();
  const fiscalYears = useFiscalYears();
  const accounts = useAccounts();
  const confirmMutation = useConfirmMcpProposal();
  const rejectMutation = useRejectMcpProposal();
  const [resolution, setResolution] = useState<'CONFIRMED' | 'REJECTED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const journal = journals.data?.find((j) => j.id === item.dto.journalId);
  const fiscalYear = fiscalYears.data?.find((fy) => fy.id === item.dto.fiscalYearId);
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));

  async function handleConfirm() {
    setError(null);
    try {
      await confirmMutation.mutateAsync(item.id);
      setResolution('CONFIRMED');
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : 'La confirmation a échoué.');
    }
  }

  async function handleReject() {
    setError(null);
    try {
      await rejectMutation.mutateAsync(item.id);
      setResolution('REJECTED');
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : 'Le rejet a échoué.');
    }
  }

  if (resolution === 'CONFIRMED') {
    return (
      <div className="rounded-lg border border-positive bg-positive-soft px-4 py-3 text-[13px] text-positive">
        ✓ Écriture enregistrée comme brouillon — validez-la depuis l'écran Écritures pour qu'elle
        entre définitivement dans la comptabilité.
      </div>
    );
  }
  if (resolution === 'REJECTED') {
    return (
      <div className="rounded-lg border border-border bg-bg px-4 py-3 text-[13px] text-ink-faint">
        Proposition rejetée — aucune écriture créée.
      </div>
    );
  }

  const isBusy = confirmMutation.isPending || rejectMutation.isPending;

  return (
    <div
      className={[
        'rounded-lg border bg-surface p-4 shadow-elevated',
        highlighted ? 'border-accent' : 'border-border',
      ].join(' ')}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
          Proposition d'écriture — non enregistrée
        </span>
        <span className="text-[11px] text-ink-faint">
          Expire le {new Date(item.expiresAt).toLocaleString('fr-FR')}
        </span>
      </div>

      {item.assumptions.length > 0 && (
        <div className="mb-2 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
          <div className="font-semibold">Hypothèses posées par l'assistant — à vérifier :</div>
          <ul className="mt-1 list-disc pl-4">
            {item.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {item.warnings.length > 0 && (
        <div className="mb-2 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
          {item.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
        <div>
          <dt className="text-[11px] text-ink-faint">Journal</dt>
          <dd className="text-ink">
            {journal ? `${journal.code} — ${journal.label}` : item.dto.journalId}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">Exercice</dt>
          <dd className="text-ink">{fiscalYear ? fiscalYear.label : item.dto.fiscalYearId}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">Date</dt>
          <dd className="text-ink">{item.dto.ecritureDate}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">Pièce</dt>
          <dd className="text-ink">{item.dto.pieceRef ?? '—'}</dd>
        </div>
      </dl>

      <div className="mt-2 text-[12.5px]">
        <span className="text-[11px] text-ink-faint">Libellé</span>
        <div className="text-ink">{item.dto.libelle}</div>
      </div>

      <div className="mt-3 overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-bg text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-2 py-1.5">Compte</th>
              <th className="px-2 py-1.5 text-right">Débit</th>
              <th className="px-2 py-1.5 text-right">Crédit</th>
            </tr>
          </thead>
          <tbody>
            {item.dto.lignes.map((ligne, i) => {
              const account = accountById.get(ligne.compteId);
              return (
                <tr key={i} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-1.5 text-ink">
                    {account ? `${account.number} — ${account.label}` : ligne.compteId}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-ink">
                    {ligne.debit ? formatMoneyFr(ligne.debit) : ''}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-ink">
                    {ligne.credit ? formatMoneyFr(ligne.credit) : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <div className="mt-2 text-[12px] text-negative">{error}</div>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={isBusy}
          className="rounded-md bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {confirmMutation.isPending ? 'Enregistrement…' : 'Confirmer'}
        </button>
        <button
          type="button"
          onClick={() => void handleReject()}
          disabled={isBusy}
          className="rounded-md border border-border bg-surface px-3.5 py-2 text-[12.5px] font-medium text-ink hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {rejectMutation.isPending ? 'Rejet…' : 'Rejeter'}
        </button>
      </div>
    </div>
  );
}
