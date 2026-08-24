import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  useAccounts,
  useChatSession,
  useChatSessions,
  useCloseCloudThread,
  useCloudCredentials,
  useCreateChatSession,
  useCreateEcriture,
  useFiscalYears,
  useJournals,
  useLocalModelAvailability,
  useSendChatMessage,
} from '../api/queries';
import type {
  ChatEngine,
  ChatMessage,
  ChatToolCall,
  CloudProvider,
  ProposedEcriture,
  ProposedEcritureLigne,
} from '../api/types';
import { ApiError } from '../api/client';
import { formatMoneyFr, isZeroMoney, normalizeMoneyInput, sanitizeAmountBuffer } from '../lib/money';

const PROVIDER_LABELS: Record<CloudProvider, string> = { CLAUDE: 'Claude', DEEPSEEK: 'DeepSeek' };

export function AssistantPage() {
  const availability = useLocalModelAvailability();
  const sessionsQuery = useChatSessions();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionQuery = useChatSession(sessionId);
  const createSession = useCreateChatSession();
  const sendMessage = useSendChatMessage();
  const closeCloudThread = useCloseCloudThread();
  const cloudCredentials = useCloudCredentials();
  const [draft, setDraft] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sessions = sessionsQuery.data ?? [];
  const configuredProviders = (cloudCredentials.data ?? []).map((c) => c.provider);
  // Which cloud thread (if any) is open on the CURRENT session — see
  // CLAUDE.md "AI chatbot cloud tier" / "server-side thread enforcement".
  // Drives whether the composer offers "☁️ Continuer avec [Provider]" +
  // "🔒 Revenir au local" (thread open) or "☁️ Proposer avec [Provider]"
  // per configured provider (no thread, gated on an attached file below) —
  // a UX mirror of the server-side gate in cloud-thread-gate.ts, not the
  // enforcement itself.
  const openThreadProvider = sessionQuery.data?.cloudProposalProvider ?? null;

  useEffect(() => {
    if (!sessionId && sessionsQuery.data && sessionsQuery.data.length > 0) {
      setSessionId(sessionsQuery.data[0].id);
    }
  }, [sessionId, sessionsQuery.data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionQuery.data?.messages.length, sendMessage.isPending]);

  const isUnavailable = availability.data ? !availability.data.available : false;
  const isBusy = createSession.isPending || sendMessage.isPending;

  async function handleNewSession() {
    setError(null);
    const session = await createSession.mutateAsync();
    setSessionId(session.id);
  }

  /**
   * Shared by both the default "Envoyer" submit (no cloudProvider — always
   * local) and every "☁️ Proposer/Continuer avec [Provider]" button
   * (cloudProvider set). The UI-side gating below (disabling a cloud
   * button with no file attached and no open thread) is a courtesy, not
   * the actual boundary — see cloud-thread-gate.ts on the backend for the
   * real, server-enforced version of the same rule.
   */
  async function doSend(cloudProvider?: CloudProvider) {
    const content = draft.trim();
    if (!content || isBusy) return;
    if (!cloudProvider && isUnavailable) return;
    setError(null);
    setDraft('');
    const files = attachedFiles;
    setAttachedFiles([]);
    try {
      let sid = sessionId;
      if (!sid) {
        const session = await createSession.mutateAsync();
        sid = session.id;
        setSessionId(sid);
      }
      await sendMessage.mutateAsync({ sessionId: sid, dto: { content, cloudProvider }, files });
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : "L'envoi a échoué.");
    }
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    void doSend();
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <aside className="flex w-56 min-h-0 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-3">
          <button
            type="button"
            onClick={() => void handleNewSession()}
            disabled={isBusy}
            className="w-full rounded-md bg-accent px-3 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Nouvelle conversation
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <p className="p-2 text-[12px] text-ink-faint">Aucune conversation pour l'instant.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSessionId(s.id)}
                className={[
                  'block w-full truncate rounded-md px-2.5 py-2 text-left text-[13px]',
                  s.id === sessionId
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:bg-bg hover:text-ink',
                ].join(' ')}
              >
                {s.title ?? 'Nouvelle conversation'}
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight text-ink">Assistant</h1>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Répond en lisant vos données comptables via un modèle exécuté localement, et peut
                proposer une écriture (y compris à partir d'une facture PDF/Excel jointe) — mais
                ne l'enregistre jamais lui-même : toute proposition doit être relue et confirmée
                par vous avant d'exister dans la comptabilité.
              </p>
            </div>
            <Link
              to="/assistant/parametres"
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-bg hover:text-ink"
            >
              ⚙️ Fournisseurs cloud
            </Link>
          </div>
        </header>

        {isUnavailable && availability.data && (
          <div className="mx-6 mt-4 rounded-md bg-warning-soft px-4 py-3 text-[13px] text-warning">
            Aucun modèle local n'est disponible en ce moment : {availability.data.detail}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {!sessionId ? (
            <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
              Démarrez une nouvelle conversation pour poser une question sur vos comptes.
            </div>
          ) : sessionQuery.isLoading ? (
            <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
              Chargement…
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {(sessionQuery.data?.messages ?? []).map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}
              {sendMessage.isPending && (
                <div className="max-w-[70%] rounded-lg bg-bg px-4 py-2.5 text-[13px] text-ink-faint">
                  Réflexion en cours… (jusqu'à une à deux minutes sur un modèle local exécuté sur
                  CPU)
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {error && (
          <div className="mx-6 mb-2 rounded-md bg-negative-soft px-4 py-2 text-[13px] text-negative">
            {error}
          </div>
        )}

        {attachedFiles.length > 0 && (
          <div className="mx-6 mb-2 flex flex-wrap gap-1.5">
            {attachedFiles.map((file, i) => (
              <span
                key={`${file.name}-${i}`}
                className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-1 text-[12px] text-accent"
              >
                📎 {file.name}
                <button
                  type="button"
                  onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="text-accent hover:text-accent-hover"
                  aria-label={`Retirer ${file.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border px-4 pt-3">
          <div className="flex items-center gap-1.5">
            <EngineBadge engine="LOCAL" cloudProvider={null} />
            <span className="text-[11.5px] text-ink-faint">
              — « Envoyer » traite toujours ce message localement. Vos données comptables ne
              quittent cet ordinateur que si vous cliquez explicitement sur une action ☁️
              ci-dessous.
            </span>
          </div>

          {openThreadProvider ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-[11.5px] text-warning">
              <EngineBadge engine="CLOUD" cloudProvider={openThreadProvider} />
              <span>
                Fil de proposition cloud ouvert avec {PROVIDER_LABELS[openThreadProvider]} — reste
                actif tant que vous continuez dessus.
              </span>
              <button
                type="button"
                onClick={() => sessionId && void closeCloudThread.mutateAsync(sessionId)}
                disabled={closeCloudThread.isPending}
                className="ml-auto shrink-0 rounded-md border border-warning px-2.5 py-1 font-medium text-warning hover:bg-warning-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                🔒 Revenir au local
              </button>
              <button
                type="button"
                onClick={() => void doSend(openThreadProvider)}
                disabled={isBusy || !draft.trim()}
                className="shrink-0 rounded-md border border-warning bg-surface px-2.5 py-1 font-medium text-warning hover:bg-warning-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                ☁️ Continuer avec {PROVIDER_LABELS[openThreadProvider]}
              </button>
            </div>
          ) : (
            configuredProviders.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {configuredProviders.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => void doSend(provider)}
                    disabled={isBusy || !draft.trim() || attachedFiles.length === 0}
                    title={
                      attachedFiles.length === 0
                        ? 'Joignez une facture pour proposer une écriture via ce fournisseur.'
                        : `Envoie cette facture et ce message à ${PROVIDER_LABELS[provider]}, en dehors de cet ordinateur.`
                    }
                    className="rounded-md border border-warning px-2.5 py-1 text-[11.5px] font-medium text-warning hover:bg-warning-soft disabled:cursor-not-allowed disabled:border-border disabled:text-ink-faint"
                  >
                    ☁️ Proposer avec {PROVIDER_LABELS[provider]}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
        <form onSubmit={handleSend} className="flex gap-2 p-4 pt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              setAttachedFiles((prev) => [...prev, ...selected]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            title="Joindre une ou plusieurs factures (PDF/Excel)"
            className="rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] text-ink-muted hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            📎
          </button>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isBusy}
            placeholder={
              isUnavailable
                ? "Modèle local indisponible — utilisez une action ☁️ ci-dessus, ou lancez-le pour l'envoi local."
                : attachedFiles.length > 0
                  ? 'Ex. « Traite la facture ci-jointe »…'
                  : 'Posez une question sur vos comptes…'
            }
            className="flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:cursor-not-allowed disabled:bg-bg"
          />
          <button
            type="submit"
            disabled={isUnavailable || isBusy || !draft.trim()}
            className="rounded-md bg-accent px-4 py-2.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            Envoyer
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'USER') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-lg bg-accent px-4 py-2.5 text-[13px] whitespace-pre-wrap text-white">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'TOOL') {
    if (message.toolName === 'propose_ecriture') {
      return (
        <ToolCallProposalRow
          content={message.content}
          engine={message.engine}
          cloudProvider={message.cloudProvider}
        />
      );
    }
    return <ToolResultTrace toolName={message.toolName} content={message.content} />;
  }

  // ASSISTANT — may carry prose content, tool calls it requested, or both.
  return (
    <div className="flex flex-col gap-1.5">
      <EngineBadge engine={message.engine} cloudProvider={message.cloudProvider} />
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1">
          {message.toolCalls.map((call) => (
            <ToolCallTrace key={call.id} call={call} />
          ))}
        </div>
      )}
      {message.content && (
        <div className="max-w-[70%] rounded-lg bg-bg px-4 py-2.5 text-[13px] whitespace-pre-wrap text-ink">
          {message.content}
        </div>
      )}
    </div>
  );
}

/**
 * The always-visible local/cloud indicator — see CLAUDE.md "AI chatbot
 * cloud tier". Every ASSISTANT/TOOL message carries a real, persisted
 * `engine` (see the ChatEngine doc comment in api/types.ts); today that's
 * always LOCAL, since no cloud engine is wired into the orchestrator yet
 * — this renders honestly rather than decoratively: it shows exactly what
 * `message.engine` says, nothing implied or guessed.
 */
function EngineBadge({
  engine,
  cloudProvider,
}: {
  engine: ChatEngine;
  cloudProvider: CloudProvider | null;
}) {
  if (engine === 'CLOUD' && cloudProvider) {
    const label = cloudProvider === 'CLAUDE' ? 'Claude' : 'DeepSeek';
    return (
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10.5px] font-medium text-warning">
        ☁️ {label}
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-positive-soft px-2 py-0.5 text-[10.5px] font-medium text-positive">
      🔒 Local
    </span>
  );
}

/** The derivation-transparency trace: which tool the model called and with what arguments. */
function ToolCallTrace({ call }: { call: ChatToolCall }) {
  return (
    <div className="max-w-[85%] rounded-md border border-dashed border-border bg-surface px-3 py-1.5 font-mono text-[11.5px] text-ink-faint">
      🔧 {call.name}({JSON.stringify(call.arguments)})
    </div>
  );
}

/** The other half of the trace: the raw data the tool returned — the actual verified figures, not the model's paraphrase of them. */
function ToolResultTrace({ toolName, content }: { toolName: string | null; content: string }) {
  const pretty = (() => {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  })();
  return (
    <details className="max-w-[85%] rounded-md border border-dashed border-border bg-surface px-3 py-1.5 text-[11.5px] text-ink-faint">
      <summary className="cursor-pointer font-mono">→ résultat de {toolName ?? '?'}</summary>
      <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-muted">
        {pretty}
      </pre>
    </details>
  );
}

/**
 * propose_ecriture's tool result is either a ProposedEcriture (render the
 * confirmable card) or `{ error }` (the proposal was rejected — same
 * validation a manual entry would hit, e.g. an unbalanced écriture or a
 * bad account id). Falls back to the generic trace for the error case,
 * since there's nothing to confirm.
 */
function ToolCallProposalRow({
  content,
  engine,
  cloudProvider,
}: {
  content: string;
  engine: ChatEngine;
  cloudProvider: CloudProvider | null;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return <ToolResultTrace toolName="propose_ecriture" content={content} />;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('dto' in parsed) ||
    !('warnings' in parsed) ||
    !('assumptions' in parsed)
  ) {
    return <ToolResultTrace toolName="propose_ecriture" content={content} />;
  }
  return (
    <ProposalCard
      proposal={parsed as ProposedEcriture}
      engine={engine}
      cloudProvider={cloudProvider}
    />
  );
}

interface EditableLigne extends ProposedEcritureLigne {
  key: string;
}

function toBuffer(value: string | undefined): string {
  return formatMoneyFr(value ?? '0.00').replace(' €', '');
}

function commitMoney(raw: string): string {
  const normalized = normalizeMoneyInput(raw || '0');
  const parsed = /^-?\d+(\.\d{1,2})?$/.test(normalized) ? normalized : '0.00';
  const [whole, frac = '00'] = parsed.split('.');
  return `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

/**
 * The confirmation gate's visible surface: a proposal from propose_ecriture,
 * fully editable, shown with its warnings/assumptions, confirmed only by
 * an explicit click that POSTs through the ORDINARY /entries endpoint
 * (useCreateEcriture — the exact hook the manual journal grid uses). This
 * component has no other way to reach the ledger.
 */
function ProposalCard({
  proposal,
  engine,
  cloudProvider,
}: {
  proposal: ProposedEcriture;
  engine: ChatEngine;
  cloudProvider: CloudProvider | null;
}) {
  const journals = useJournals();
  const fiscalYears = useFiscalYears();
  const accounts = useAccounts();
  const createEcriture = useCreateEcriture();

  const [journalId, setJournalId] = useState(proposal.dto.journalId);
  const [fiscalYearId, setFiscalYearId] = useState(proposal.dto.fiscalYearId);
  const [ecritureDate, setEcritureDate] = useState(proposal.dto.ecritureDate);
  const [pieceRef, setPieceRef] = useState(proposal.dto.pieceRef ?? '');
  const [libelle, setLibelle] = useState(proposal.dto.libelle);
  const [lignes, setLignes] = useState<EditableLigne[]>(() =>
    proposal.dto.lignes.map((ligne, i) => ({ ...ligne, key: `ligne-${i}` })),
  );
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateLigne(key: string, patch: Partial<EditableLigne>) {
    setLignes((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function handleConfirm() {
    setError(null);
    try {
      const result = await createEcriture.mutateAsync({
        journalId,
        fiscalYearId,
        ecritureDate,
        pieceRef: pieceRef || undefined,
        libelle,
        lignes: lignes.map((l) => ({
          compteId: l.compteId,
          debit: !l.debit || isZeroMoney(l.debit) ? undefined : l.debit,
          credit: !l.credit || isZeroMoney(l.credit) ? undefined : l.credit,
          vatRateId: l.vatRateId || undefined,
        })),
      });
      setConfirmedId(result.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : "L'enregistrement a échoué.");
    }
  }

  if (confirmedId) {
    return (
      <div className="max-w-[85%] rounded-lg border border-positive bg-positive-soft px-4 py-3 text-[13px] text-positive">
        ✓ Écriture enregistrée comme brouillon — validez-la depuis l'écran Écritures pour qu'elle
        entre définitivement dans la comptabilité.
      </div>
    );
  }

  const isCloud = engine === 'CLOUD';

  return (
    <div
      className={[
        'max-w-[85%] rounded-lg border bg-surface p-4',
        isCloud ? 'border-warning' : 'border-accent',
      ].join(' ')}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className={[
            'text-[11px] font-semibold uppercase tracking-wide',
            isCloud ? 'text-warning' : 'text-accent',
          ].join(' ')}
        >
          Proposition d'écriture — non enregistrée, à relire avant de confirmer
        </span>
        <EngineBadge engine={engine} cloudProvider={cloudProvider} />
      </div>

      {proposal.assumptions.length > 0 && (
        <div className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
          <div className="font-semibold">Hypothèses posées par l'assistant — à vérifier :</div>
          <ul className="mt-1 list-disc pl-4">
            {proposal.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {proposal.warnings.length > 0 && (
        <div className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
          {proposal.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Journal</span>
          <select
            value={journalId}
            onChange={(e) => setJournalId(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-ink"
          >
            {journals.data?.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} — {j.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Exercice</span>
          <select
            value={fiscalYearId}
            onChange={(e) => setFiscalYearId(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-ink"
          >
            {fiscalYears.data?.map((fy) => (
              <option key={fy.id} value={fy.id}>
                {fy.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Date</span>
          <input
            type="date"
            value={ecritureDate}
            onChange={(e) => setEcritureDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Pièce (optionnel)</span>
          <input
            type="text"
            value={pieceRef}
            onChange={(e) => setPieceRef(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-ink"
          />
        </label>
      </div>

      <label className="mt-2 flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Libellé</span>
        <input
          type="text"
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-ink"
        />
      </label>

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
            {lignes.map((ligne) => (
              <ProposalLigneRow
                key={ligne.key}
                ligne={ligne}
                accounts={accounts.data ?? []}
                onChange={(patch) => updateLigne(ligne.key, patch)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {error && <div className="mt-2 text-[12px] text-negative">{error}</div>}

      <button
        type="button"
        onClick={() => void handleConfirm()}
        disabled={createEcriture.isPending}
        className="mt-3 rounded-md bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {createEcriture.isPending ? 'Enregistrement…' : 'Confirmer et enregistrer en brouillon'}
      </button>
    </div>
  );
}

function ProposalLigneRow({
  ligne,
  accounts,
  onChange,
}: {
  ligne: EditableLigne;
  accounts: { id: string; number: string; label: string }[];
  onChange: (patch: Partial<EditableLigne>) => void;
}) {
  const [debitBuffer, setDebitBuffer] = useState(() => toBuffer(ligne.debit));
  const [creditBuffer, setCreditBuffer] = useState(() => toBuffer(ligne.credit));

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-2 py-1.5">
        <select
          value={ligne.compteId}
          onChange={(e) => onChange({ compteId: e.target.value })}
          className="w-full rounded-md border border-border bg-surface px-1.5 py-1 text-[12px] text-ink"
        >
          {!accounts.some((a) => a.id === ligne.compteId) && (
            <option value={ligne.compteId}>{ligne.compteId}</option>
          )}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.number} — {a.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          type="text"
          inputMode="decimal"
          value={debitBuffer}
          onChange={(e) => setDebitBuffer(sanitizeAmountBuffer(e.target.value))}
          onBlur={(e) => {
            const value = commitMoney(e.target.value);
            setDebitBuffer(toBuffer(value));
            onChange({ debit: value });
          }}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right text-[12px] tabular-nums text-ink"
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          type="text"
          inputMode="decimal"
          value={creditBuffer}
          onChange={(e) => setCreditBuffer(sanitizeAmountBuffer(e.target.value))}
          onBlur={(e) => {
            const value = commitMoney(e.target.value);
            setCreditBuffer(toBuffer(value));
            onChange({ credit: value });
          }}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right text-[12px] tabular-nums text-ink"
        />
      </td>
    </tr>
  );
}
