import { useMemo, useState } from 'react';
import type {
  Account,
  BankAccount,
  BankStatementLine,
  MatchCandidate,
  StatementLineMatchProposal,
  StatementPreviewResponse,
} from '../api/types';
import type { CreateEcritureDto, CreateTiersDto } from '../api/dto';
import {
  useAccounts,
  useBankAccounts,
  useBankAggregatorLinks,
  useClearMatch,
  useConfirmMatch,
  useConfirmStatementImport,
  useCreateBankAccount,
  useCreateConnectSession,
  useCreateEcritureFromStatementLine,
  useCreateTiers,
  useFiscalYears,
  useIgnoreStatementLine,
  useJournals,
  usePreviewStatement,
  useReconciliationProposals,
  useRevokeLink,
  useStatementLines,
  useSyncNow,
} from '../api/queries';
import { ApiError } from '../api/client';
import { formatMoneyFr, isNegativeMoney } from '../lib/money';
import { isAuxiliaryBearingAccount } from '../lib/accounts';
import { AccountCombobox } from '../components/journal/AccountCombobox';
import { IconWallet } from '../components/layout/icons';

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function isBankEligibleAccount(account: Account): boolean {
  return account.pcgClass === 5 && /^51[2467]/.test(account.number);
}

/**
 * Bank reconciliation — Layer 1a (statement import + matching engine +
 * review UI). See CLAUDE.md "Bank reconciliation". Nothing here
 * auto-posts or auto-reconciles: every match is a proposal (recomputed
 * fresh, never persisted server-side) confirmed by an explicit click.
 */
export function BankReconciliationPage() {
  const bankAccountsQuery = useBankAccounts();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const bankAccounts = bankAccountsQuery.data ?? [];
  const selected = bankAccounts.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">
          Rapprochement bancaire
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Import de relevé (CAMT.053) et lettrage assisté — chaque correspondance proposée doit
          être confirmée, rien n'est jamais rapproché automatiquement.
        </p>
      </header>

      <BankAccountPicker
        bankAccounts={bankAccounts}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {selected && (
        <>
          <AggregatorSection bankAccount={selected} />
          <StatementImportSection bankAccount={selected} />
          <ReconciliationReview bankAccount={selected} />
        </>
      )}
    </div>
  );
}

function BankAccountPicker({
  bankAccounts,
  selectedId,
  onSelect,
}: {
  bankAccounts: BankAccount[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const accountsQuery = useAccounts();
  const createBankAccount = useCreateBankAccount();
  const [showCreate, setShowCreate] = useState(bankAccounts.length === 0);
  const [compteId, setCompteId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [iban, setIban] = useState('');
  const [error, setError] = useState<string | null>(null);

  const eligibleAccounts = (accountsQuery.data ?? []).filter(isBankEligibleAccount);

  async function handleCreate() {
    if (!compteId || label.trim() === '') return;
    setError(null);
    try {
      const created = await createBankAccount.mutateAsync({
        compteId,
        label: label.trim(),
        iban: iban.trim() || undefined,
      });
      onSelect(created.id);
      setShowCreate(false);
      setCompteId(null);
      setLabel('');
      setIban('');
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : "La création a échoué.");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        {bankAccounts.length > 0 && (
          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            Compte bancaire
            <select
              value={selectedId ?? ''}
              onChange={(e) => onSelect(e.target.value)}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            >
              <option value="" disabled>
                Choisir…
              </option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12.5px] font-medium text-ink-muted hover:border-accent hover:text-accent"
        >
          <IconWallet width={13} height={13} />
          + Nouveau compte bancaire
        </button>
      </div>

      {showCreate && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <label className="flex flex-col gap-1 text-[12px] text-ink-faint">
            Compte PCG (512/514/516/517)
            <select
              value={compteId ?? ''}
              onChange={(e) => setCompteId(e.target.value || null)}
              className="w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            >
              <option value="">Choisir un compte…</option>
              {eligibleAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number} — {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-faint">
            Libellé
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Compte courant BNP Paribas"
              className="w-56 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-faint">
            IBAN (facultatif)
            <input
              type="text"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder="FR76…"
              className="w-56 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </label>
          <button
            type="button"
            disabled={!compteId || label.trim() === '' || createBankAccount.isPending}
            onClick={() => void handleCreate()}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            Créer
          </button>
          {error && <span className="text-[12px] text-negative">{error}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Live bank-aggregator connectivity (Layer 1b — see CLAUDE.md "Bank
 * reconciliation — Layer 1b"). Deliberately does NOT retire manual
 * CAMT.053 import (StatementImportSection, below) — a BankAccount can
 * have a manual-only history, a live link, or both.
 *
 * The "confirm" half of the Connect flow is honestly NOT wired here:
 * Bridge's real callback mechanism (redirect vs. postMessage) is an
 * unconfirmed placeholder in the backend adapter (see
 * `bridge-aggregator.adapter.ts`'s own doc comment) — faking a confirm
 * button with a made-up payload shape would silently create a wrong
 * link rather than honestly show "not yet wired," so this only opens
 * the Connect session; sync/revoke are fully real and wired, since they
 * don't depend on that unconfirmed shape.
 */
function AggregatorSection({ bankAccount }: { bankAccount: BankAccount }) {
  const linksQuery = useBankAggregatorLinks();
  const [showConsent, setShowConsent] = useState(false);
  const syncNow = useSyncNow(bankAccount.id);
  const revokeLink = useRevokeLink(bankAccount.id);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const link = (linksQuery.data ?? []).find((l) => l.bankAccountId === bankAccount.id) ?? null;

  async function handleSync() {
    setError(null);
    setSyncResult(null);
    try {
      const result = await syncNow.mutateAsync();
      setSyncResult(
        result.importedLines > 0
          ? `${result.importedLines} nouvelle(s) ligne(s) importée(s).`
          : 'Aucune nouvelle transaction.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : 'La synchronisation a échoué.');
    }
  }

  async function handleRevoke() {
    setError(null);
    try {
      await revokeLink.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : 'La déconnexion a échoué.');
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <h2 className="text-[14px] font-semibold text-ink">Connexion bancaire en direct</h2>
      {link ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">
            🔗 Bridge
          </span>
          <span className="text-ink-muted">{link.maskedAccessToken}</span>
          <span className="text-ink-faint">
            {link.lastSyncedAt
              ? `Dernière synchro : ${formatDate(link.lastSyncedAt)}`
              : 'Jamais synchronisé'}
          </span>
          <button
            type="button"
            disabled={syncNow.isPending || link.status !== 'ACTIVE'}
            onClick={() => void handleSync()}
            className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncNow.isPending ? 'Synchronisation…' : 'Synchroniser maintenant'}
          </button>
          <button
            type="button"
            disabled={revokeLink.isPending}
            onClick={() => void handleRevoke()}
            className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-ink-faint hover:bg-bg hover:text-negative disabled:opacity-50"
          >
            Déconnecter
          </button>
        </div>
      ) : (
        <div className="mt-2.5">
          <p className="text-[12.5px] text-ink-muted">
            Synchronise automatiquement les relevés de ce compte via Bridge, au lieu d'un import
            manuel — voir « Importer un relevé » ci-dessous, qui reste disponible dans tous les cas.
          </p>
          <button
            type="button"
            onClick={() => setShowConsent(true)}
            className="mt-2 rounded-md border border-dashed border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-muted hover:border-accent hover:text-accent"
          >
            ☁️ Connecter via Bridge…
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[12.5px] text-negative">{error}</p>}
      {syncResult && <p className="mt-2 text-[12.5px] text-positive">{syncResult}</p>}

      {showConsent && (
        <AggregatorConsentDialog bankAccount={bankAccount} onClose={() => setShowConsent(false)} />
      )}
    </div>
  );
}

function AggregatorConsentDialog({
  bankAccount,
  onClose,
}: {
  bankAccount: BankAccount;
  onClose: () => void;
}) {
  const createSession = useCreateConnectSession(bankAccount.id);
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState<'consent' | 'connect'>('consent');
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setError(null);
    try {
      const { connectUrl } = await createSession.mutateAsync();
      window.open(connectUrl, '_blank', 'noopener,noreferrer');
      setStep('connect');
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : 'La connexion a échoué.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bridge-consent-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'consent' ? (
          <>
            <h2 id="bridge-consent-title" className="text-[15px] font-semibold text-ink">
              Connecter « {bankAccount.label} » via Bridge ?
            </h2>
            <div className="mt-3 flex flex-col gap-3 text-[12.5px] leading-relaxed text-ink-muted">
              <p>
                En vous connectant, vous autoriserez Bridge (agrégateur bancaire agréé DSP2/ACPR) à
                accéder en lecture seule aux relevés de ce compte auprès de votre banque, puis à les
                transmettre à cette application pour alimenter le rapprochement bancaire — exactement
                les mêmes données qu'un import manuel de relevé, mais synchronisées automatiquement.
                Cette application ne peut jamais initier de virement ni modifier votre compte.
              </p>
              <p className="italic text-warning">
                ⚠️ Contrairement au volet « assistant IA cloud », les conditions exactes de résidence
                des données et la politique de confidentialité de Bridge n'ont pas été vérifiées de
                façon indépendante dans cette version — consultez sa politique de confidentialité
                avant d'activer.
              </p>
            </div>
            <a
              href="https://www.bridgeapi.io"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[12px] text-accent hover:text-accent-hover"
            >
              Site de Bridge ↗
            </a>
            <label className="mt-4 flex items-start gap-2 rounded-md bg-warning-soft p-2.5 text-[12.5px] text-warning">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span className="italic">
                J'ai compris que les relevés de ce compte seront transmis à Bridge puis à cette
                application, et j'accepte de me connecter.
              </span>
            </label>
            {error && <div className="mt-2 text-[12px] text-negative">{error}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3.5 py-2 text-[12.5px] text-ink-muted hover:bg-bg"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!checked || createSession.isPending}
                onClick={() => void handleConnect()}
                className="rounded-md bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
              >
                {createSession.isPending ? 'Ouverture…' : 'Se connecter à ma banque via Bridge'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[15px] font-semibold text-ink">Connexion en cours</h2>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
              Terminez la connexion à votre banque dans l'onglet qui vient de s'ouvrir. Cette étape
              n'est pas encore automatiquement finalisée dans cette version — voir CLAUDE.md « Bank
              reconciliation — Layer 1b » pour l'état exact de cette limitation.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3.5 py-2 text-[12.5px] text-ink-muted hover:bg-bg"
              >
                Fermer
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatementImportSection({ bankAccount }: { bankAccount: BankAccount }) {
  const preview = usePreviewStatement();
  const confirmImport = useConfirmStatementImport();
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<StatementPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handlePreview() {
    if (!file) return;
    setError(null);
    setSuccess(null);
    try {
      const result = await preview.mutateAsync({ bankAccountId: bankAccount.id, file });
      setPreviewData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : "L'aperçu a échoué.");
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setError(null);
    try {
      await confirmImport.mutateAsync({ bankAccountId: bankAccount.id, file });
      setSuccess('Relevé importé.');
      setPreviewData(null);
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : "L'import a échoué.");
    }
  }

  const duplicateCount = previewData?.lines.filter((l) => l.isDuplicate).length ?? 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <h2 className="text-[14px] font-semibold text-ink">Importer un relevé (CAMT.053)</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <input
          type="file"
          accept=".xml"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreviewData(null);
            setSuccess(null);
          }}
          className="text-[13px] text-ink-muted"
        />
        <button
          type="button"
          disabled={!file || preview.isPending}
          onClick={() => void handlePreview()}
          className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {preview.isPending ? 'Analyse…' : 'Aperçu'}
        </button>
        {previewData && (
          <button
            type="button"
            disabled={confirmImport.isPending}
            onClick={() => void handleConfirm()}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {confirmImport.isPending ? 'Import…' : "Confirmer l'import"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-[12.5px] text-negative">{error}</p>}
      {success && <p className="mt-2 text-[12.5px] text-positive">{success}</p>}

      {previewData && (
        <div className="mt-3 rounded-md border border-border bg-bg p-3 text-[12.5px]">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-ink-muted">
            <span>
              Période : {formatDate(previewData.periodStart)} → {formatDate(previewData.periodEnd)}
            </span>
            <span>
              Solde initial : <span className="tabular-nums text-ink">{formatMoneyFr(previewData.openingBalance)}</span>
            </span>
            <span>
              Solde final : <span className="tabular-nums text-ink">{formatMoneyFr(previewData.closingBalance)}</span>
            </span>
            <span>{previewData.lines.length} ligne(s)</span>
            {duplicateCount > 0 && (
              <span className="font-medium text-warning">
                {duplicateCount} ligne(s) déjà importée(s) — la confirmation sera refusée
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type ReviewTier = 'HIGH' | 'AMBIGUOUS' | 'UNMATCHED_NO_CANDIDATE' | 'DONE';

function ReconciliationReview({ bankAccount }: { bankAccount: BankAccount }) {
  const linesQuery = useStatementLines(bankAccount.id);
  const proposalsQuery = useReconciliationProposals(bankAccount.id);
  const [creatingFor, setCreatingFor] = useState<BankStatementLine | null>(null);

  const lines = linesQuery.data ?? [];
  const proposalsByLine = useMemo(() => {
    const map = new Map<string, StatementLineMatchProposal>();
    for (const p of proposalsQuery.data ?? []) map.set(p.statementLineId, p);
    return map;
  }, [proposalsQuery.data]);

  function tierOf(line: BankStatementLine): ReviewTier {
    if (line.status !== 'UNMATCHED') return 'DONE';
    const proposal = proposalsByLine.get(line.id);
    if (!proposal || proposal.confidence === 'NO_CANDIDATE') return 'UNMATCHED_NO_CANDIDATE';
    return proposal.confidence;
  }

  const high = lines.filter((l) => tierOf(l) === 'HIGH');
  const ambiguous = lines.filter((l) => tierOf(l) === 'AMBIGUOUS');
  const noCandidate = lines.filter((l) => tierOf(l) === 'UNMATCHED_NO_CANDIDATE');
  const done = lines.filter((l) => tierOf(l) === 'DONE');

  if (lines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
        Aucun relevé importé pour ce compte.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {high.length > 0 && (
        <ReviewSection
          title="Correspondances évidentes"
          tone="positive"
          lines={high}
          proposalsByLine={proposalsByLine}
          bankAccount={bankAccount}
          onCreateEcriture={setCreatingFor}
        />
      )}
      {ambiguous.length > 0 && (
        <ReviewSection
          title="À vérifier — plusieurs candidats"
          tone="warning"
          lines={ambiguous}
          proposalsByLine={proposalsByLine}
          bankAccount={bankAccount}
          onCreateEcriture={setCreatingFor}
        />
      )}
      {noCandidate.length > 0 && (
        <ReviewSection
          title="Sans correspondance"
          tone="muted"
          lines={noCandidate}
          proposalsByLine={proposalsByLine}
          bankAccount={bankAccount}
          onCreateEcriture={setCreatingFor}
        />
      )}
      {done.length > 0 && <TreatedSection lines={done} bankAccount={bankAccount} />}

      {creatingFor && (
        <CreateEcritureModal
          bankAccount={bankAccount}
          statementLine={creatingFor}
          onClose={() => setCreatingFor(null)}
        />
      )}
    </div>
  );
}

const TONE_CLASSES: Record<'positive' | 'warning' | 'muted', string> = {
  positive: 'border-positive/30 bg-positive-soft/40',
  warning: 'border-warning/30 bg-warning-soft/40',
  muted: 'border-border bg-bg',
};

function ReviewSection({
  title,
  tone,
  lines,
  proposalsByLine,
  bankAccount,
  onCreateEcriture,
}: {
  title: string;
  tone: 'positive' | 'warning' | 'muted';
  lines: BankStatementLine[];
  proposalsByLine: Map<string, StatementLineMatchProposal>;
  bankAccount: BankAccount;
  onCreateEcriture: (line: BankStatementLine) => void;
}) {
  const confirmMatch = useConfirmMatch(bankAccount.id);
  const ignoreLine = useIgnoreStatementLine(bankAccount.id);
  const [selectedCandidate, setSelectedCandidate] = useState<Record<string, string>>({});

  return (
    <div className={`rounded-lg border p-4 shadow-card ${TONE_CLASSES[tone]}`}>
      <h3 className="text-[13px] font-semibold text-ink">
        {title} <span className="font-normal text-ink-faint">({lines.length})</span>
      </h3>
      <div className="mt-2.5 flex flex-col gap-2">
        {lines.map((line) => {
          const proposal = proposalsByLine.get(line.id);
          const candidates = proposal?.candidates ?? [];
          const chosenId = selectedCandidate[line.id] ?? candidates[0]?.ecritureLigneId ?? '';
          return (
            <div
              key={line.id}
              className="flex flex-wrap items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-[12.5px]"
            >
              <span className="w-20 shrink-0 tabular-nums text-ink-muted">
                {formatDate(line.bookingDate)}
              </span>
              <span
                className={`w-24 shrink-0 text-right tabular-nums font-medium ${isNegativeMoney(line.amount) ? 'text-negative' : 'text-positive'}`}
              >
                {formatMoneyFr(line.amount)}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{line.label}</span>

              {candidates.length > 0 && (
                <>
                  {candidates.length > 1 ? (
                    <select
                      value={chosenId}
                      onChange={(e) =>
                        setSelectedCandidate((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                      className="max-w-[260px] rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
                    >
                      {candidates.map((c) => (
                        <CandidateOption key={c.ecritureLigneId} candidate={c} />
                      ))}
                    </select>
                  ) : (
                    <span className="max-w-[260px] truncate text-ink-faint" title={candidates[0].libelle}>
                      {candidates[0].ecritureNum ? `N°${candidates[0].ecritureNum} — ` : ''}
                      {candidates[0].libelle}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={confirmMatch.isPending}
                    onClick={() =>
                      void confirmMatch.mutateAsync({ statementLineId: line.id, ecritureLigneId: chosenId })
                    }
                    className="shrink-0 rounded-md bg-positive px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Confirmer
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => onCreateEcriture(line)}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-ink-muted hover:border-accent hover:text-accent"
              >
                Créer une écriture
              </button>
              <button
                type="button"
                disabled={ignoreLine.isPending}
                onClick={() => void ignoreLine.mutateAsync({ statementLineId: line.id })}
                className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-ink-faint hover:bg-bg hover:text-ink-muted disabled:opacity-50"
              >
                Ignorer
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CandidateOption({ candidate }: { candidate: MatchCandidate }) {
  return (
    <option value={candidate.ecritureLigneId}>
      {candidate.ecritureNum ? `N°${candidate.ecritureNum} — ` : ''}
      {candidate.libelle} ({formatDate(candidate.ecritureDate)})
    </option>
  );
}

function TreatedSection({
  lines,
  bankAccount,
}: {
  lines: BankStatementLine[];
  bankAccount: BankAccount;
}) {
  const [expanded, setExpanded] = useState(false);
  const clearMatch = useClearMatch(bankAccount.id);

  return (
    <div className="rounded-lg border border-border bg-bg/60 p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[12.5px] font-medium text-ink-faint hover:text-ink-muted"
      >
        {expanded ? '▾' : '▸'} Traité ({lines.length})
      </button>
      {expanded && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {lines.map((line) => (
            <div
              key={line.id}
              className="flex flex-wrap items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[12px]"
            >
              <span className="w-20 shrink-0 tabular-nums text-ink-faint">
                {formatDate(line.bookingDate)}
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums text-ink-muted">
                {formatMoneyFr(line.amount)}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-muted">{line.label}</span>
              <span
                className={
                  line.status === 'CONFIRMED'
                    ? 'shrink-0 rounded-full bg-positive-soft px-2 py-0.5 text-[10.5px] font-medium text-positive'
                    : 'shrink-0 rounded-full bg-bg px-2 py-0.5 text-[10.5px] font-medium text-ink-faint'
                }
              >
                {line.status === 'CONFIRMED' ? 'Rapproché' : 'Ignoré'}
                {line.ignoredReason ? ` — ${line.ignoredReason}` : ''}
              </span>
              {line.status === 'CONFIRMED' && (
                <button
                  type="button"
                  disabled={clearMatch.isPending}
                  onClick={() => void clearMatch.mutateAsync(line.id)}
                  className="shrink-0 text-[11.5px] text-ink-faint hover:text-negative disabled:opacity-50"
                >
                  Annuler
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lightweight prefilled create form — the bank side of the line is already known (this account, this amount/sign); the human only picks the offsetting account. */
function CreateEcritureModal({
  bankAccount,
  statementLine,
  onClose,
}: {
  bankAccount: BankAccount;
  statementLine: BankStatementLine;
  onClose: () => void;
}) {
  const accountsQuery = useAccounts();
  const journalsQuery = useJournals();
  const fiscalYearsQuery = useFiscalYears();
  const createTiers = useCreateTiers();
  const createFromLine = useCreateEcritureFromStatementLine(bankAccount.id);

  const [otherAccountId, setOtherAccountId] = useState<string | null>(null);
  const [otherAuxId, setOtherAuxId] = useState<string | null>(null);
  const [libelle, setLibelle] = useState(statementLine.label);
  const [error, setError] = useState<string | null>(null);

  const accounts = accountsQuery.data ?? [];
  const otherAccount = accounts.find((a) => a.id === otherAccountId);
  const needsAux = Boolean(otherAccount && isAuxiliaryBearingAccount(otherAccount));
  const auxAccounts = otherAccount
    ? accounts.filter((a) => a.isAuxiliary && a.parentId === otherAccount.id)
    : [];

  const journal = (journalsQuery.data ?? []).find((j) => j.type === 'BANQUE');
  const amount = statementLine.amount.replace('-', '');
  const isInflow = !isNegativeMoney(statementLine.amount);
  const fiscalYear = (fiscalYearsQuery.data ?? []).find(
    (fy) => fy.startDate.slice(0, 10) <= statementLine.bookingDate.slice(0, 10) &&
      statementLine.bookingDate.slice(0, 10) <= fy.endDate.slice(0, 10),
  );

  const canSubmit =
    Boolean(otherAccountId) && (!needsAux || Boolean(otherAuxId)) && Boolean(journal) && Boolean(fiscalYear);

  async function handleCreate() {
    if (!canSubmit || !journal || !fiscalYear || !otherAccountId) return;
    setError(null);
    const dto: CreateEcritureDto = {
      journalId: journal.id,
      fiscalYearId: fiscalYear.id,
      ecritureDate: statementLine.bookingDate.slice(0, 10),
      libelle: libelle.trim() || statementLine.label,
      lignes: [
        {
          compteId: bankAccount.compteId,
          debit: isInflow ? amount : undefined,
          credit: isInflow ? undefined : amount,
        },
        {
          compteId: otherAccountId,
          compteAuxId: otherAuxId ?? undefined,
          debit: isInflow ? undefined : amount,
          credit: isInflow ? amount : undefined,
        },
      ],
    };
    try {
      await createFromLine.mutateAsync({ statementLineId: statementLine.id, dto });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : "La création a échoué.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold text-ink">Créer une écriture</h2>
        <p className="mt-1 text-[12.5px] text-ink-faint">
          {formatDate(statementLine.bookingDate)} · {formatMoneyFr(statementLine.amount)} ·{' '}
          {bankAccount.label}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-ink-faint">
            Libellé
            <input
              type="text"
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-faint">
            Compte de contrepartie
            <AccountCombobox
              accounts={accounts}
              value={otherAccountId}
              onSelect={(id) => {
                setOtherAccountId(id);
                setOtherAuxId(null);
              }}
              placeholder="N° compte"
            />
          </label>
          {needsAux && (
            <label className="flex flex-col gap-1 text-[12px] text-ink-faint">
              Tiers
              <AccountCombobox
                accounts={auxAccounts}
                value={otherAuxId}
                onSelect={setOtherAuxId}
                placeholder="N° tiers"
                createLabel="nouveau tiers"
                onCreateNew={
                  otherAccount
                    ? (label) =>
                        createTiers.mutateAsync({
                          parentId: otherAccount.id,
                          dto: { label } satisfies CreateTiersDto,
                        })
                    : undefined
                }
              />
            </label>
          )}
        </div>

        {!fiscalYear && (
          <p className="mt-3 text-[12px] text-negative">
            Aucun exercice ne couvre la date de cette ligne.
          </p>
        )}
        {error && <p className="mt-3 text-[12px] text-negative">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!canSubmit || createFromLine.isPending}
            onClick={() => void handleCreate()}
            className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            {createFromLine.isPending ? 'Création…' : "Créer l'écriture"}
          </button>
        </div>
      </div>
    </div>
  );
}
