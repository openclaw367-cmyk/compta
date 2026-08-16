import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  useChatSession,
  useChatSessions,
  useCreateChatSession,
  useLocalModelAvailability,
  useSendChatMessage,
} from '../api/queries';
import type { ChatMessage, ChatToolCall } from '../api/types';

export function AssistantPage() {
  const availability = useLocalModelAvailability();
  const sessionsQuery = useChatSessions();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionQuery = useChatSession(sessionId);
  const createSession = useCreateChatSession();
  const sendMessage = useSendChatMessage();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const sessions = sessionsQuery.data ?? [];

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

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || isBusy || isUnavailable) return;
    setError(null);
    setDraft('');
    try {
      let sid = sessionId;
      if (!sid) {
        const session = await createSession.mutateAsync();
        sid = session.id;
        setSessionId(sid);
      }
      await sendMessage.mutateAsync({ sessionId: sid, dto: { content } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'envoi a échoué.");
    }
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
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Assistant</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Répond en lisant vos données comptables (balance, liasse, TVA, flux de trésorerie,
            analyse financière, résultat fiscal, immobilisations, écritures) via un modèle
            exécuté localement. Rien n'est écrit dans la comptabilité par cet assistant — cette
            version ne consulte que la lecture.
          </p>
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
            <div className="text-[13px] text-ink-faint">Chargement…</div>
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

        <form onSubmit={(e) => void handleSend(e)} className="flex gap-2 border-t border-border p-4">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isUnavailable || isBusy}
            placeholder={
              isUnavailable
                ? 'Assistant indisponible — lancez un modèle local pour continuer.'
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
    return <ToolResultTrace toolName={message.toolName} content={message.content} />;
  }

  // ASSISTANT — may carry prose content, tool calls it requested, or both.
  return (
    <div className="flex flex-col gap-1.5">
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
