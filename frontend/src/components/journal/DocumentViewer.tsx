import { useEffect, useRef, useState } from 'react';
import type { EcritureDocument } from '../../api/types';
import { api } from '../../api/client';
import {
  useEcritureDocumentAuditLog,
  useEcritureDocuments,
  useAttachDocument,
  useReplaceDocument,
  useRemoveDocument,
} from '../../api/queries';
import { ApiError } from '../../api/client';
import { IconPaperclip } from '../layout/icons';

const ACCEPTED_TYPES = '.pdf,.jpg,.jpeg,.png';

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

const ACTION_LABEL: Record<string, string> = {
  ATTACHED: 'Joint',
  REPLACED: 'Remplacé',
  REMOVED: 'Retiré',
};

/**
 * The list-row entry point — always rendered (not just when documentCount
 * > 0), so attaching a first document to an existing entry has an
 * affordance too, not just during creation. Muted/outline when empty,
 * filled with a count badge once at least one document exists. See
 * CLAUDE.md "Supporting-document attachments".
 */
export function DocumentIndicator({
  ecritureId,
  documentCount,
}: {
  ecritureId: string;
  documentCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={documentCount > 0 ? `${documentCount} document${documentCount > 1 ? 's' : ''} joint${documentCount > 1 ? 's' : ''}` : 'Joindre un document'}
        className={[
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] transition-colors',
          documentCount > 0
            ? 'text-accent hover:bg-accent-soft'
            : 'text-ink-faint hover:bg-bg hover:text-ink-muted',
        ].join(' ')}
      >
        <IconPaperclip width={13} height={13} />
        {documentCount > 0 && <span className="tabular-nums">{documentCount}</span>}
      </button>
      {open && <DocumentViewerModal ecritureId={ecritureId} onClose={() => setOpen(false)} />}
    </>
  );
}

function useObjectUrl(ecritureId: string, document: EcritureDocument | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!document) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    api.getBlob(`/entries/${ecritureId}/documents/${document.id}/file`).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ecritureId, document]);
  return url;
}

/**
 * The popover-that-becomes-full-screen viewer, plus attach/replace/remove
 * and a collapsed "Historique" section — the audit trail Part 4 of the
 * design creates is genuinely inspectable, not backend-only. Reuses this
 * app's one existing modal vocabulary (AssistantSettingsPage's
 * ConsentDialog: fixed inset-0, bg-black/40, role="dialog", shadow-elevated).
 */
function DocumentViewerModal({ ecritureId, onClose }: { ecritureId: string; onClose: () => void }) {
  const documentsQuery = useEcritureDocuments(ecritureId);
  const auditLogQuery = useEcritureDocumentAuditLog(ecritureId);
  const attach = useAttachDocument();
  const replace = useReplaceDocument();
  const remove = useRemoveDocument();
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const documents = documentsQuery.data ?? [];
  const selected = documents.find((d) => d.id === selectedId) ?? documents[0] ?? null;
  const objectUrl = useObjectUrl(ecritureId, selected);

  function reportError(err: unknown) {
    setError(err instanceof ApiError ? err.details.join(' ') : "L'opération a échoué.");
  }

  async function handleAttach(file: File) {
    setError(null);
    try {
      const created = await attach.mutateAsync({ ecritureId, file });
      setSelectedId(created.id);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleReplace(file: File) {
    if (!selected) return;
    setError(null);
    try {
      await replace.mutateAsync({ ecritureId, documentId: selected.id, file });
    } catch (err) {
      reportError(err);
    }
  }

  async function handleRemove() {
    if (!selected) return;
    if (!window.confirm(`Retirer « ${selected.fileName} » de cette écriture ?`)) return;
    setError(null);
    try {
      await remove.mutateAsync({ ecritureId, documentId: selected.id });
      setSelectedId(null);
    } catch (err) {
      reportError(err);
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
        aria-labelledby="document-viewer-title"
        className={[
          'flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-elevated transition-all',
          expanded ? 'h-[92vh] max-w-[92vw]' : 'max-h-[85vh] max-w-2xl',
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="document-viewer-title" className="truncate text-[14px] font-semibold text-ink">
              {selected ? selected.fileName : 'Documents joints'}
            </h2>
            {selected && (
              <p className="text-[11.5px] text-ink-faint">Joint le {formatDate(selected.uploadedAt)}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {documents.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? 'Réduire' : 'Agrandir'}
                className="rounded p-1.5 text-ink-faint hover:bg-bg hover:text-ink"
              >
                {expanded ? '⤡' : '⤢'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Fermer"
              className="rounded p-1.5 text-ink-faint hover:bg-bg hover:text-ink"
            >
              ×
            </button>
          </div>
        </div>

        {documents.length > 1 && (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border bg-bg px-4 py-2">
            {documents.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedId(d.id)}
                className={[
                  'max-w-[220px] truncate rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                  selected?.id === d.id
                    ? 'bg-accent-soft text-accent'
                    : 'bg-surface text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {d.fileName}
              </button>
            ))}
          </div>
        )}

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-bg p-3">
          {documentsQuery.isLoading ? (
            <p className="text-[13px] text-ink-faint">Chargement…</p>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <IconPaperclip width={22} height={22} className="text-ink-faint" />
              <p className="text-[13px] text-ink-muted">Aucun document joint à cette écriture.</p>
            </div>
          ) : !objectUrl ? (
            <p className="text-[13px] text-ink-faint">Chargement du document…</p>
          ) : selected?.mimeType === 'application/pdf' ? (
            <embed
              src={objectUrl}
              type="application/pdf"
              className="h-full w-full rounded-md border border-border bg-surface"
            />
          ) : (
            <img
              src={objectUrl}
              alt={selected?.fileName}
              className="max-h-full max-w-full rounded-md border border-border object-contain"
            />
          )}
        </div>

        {error && (
          <p className="shrink-0 border-t border-border bg-negative-soft px-4 py-2 text-[12.5px] text-negative">
            {error}
          </p>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
          <input
            ref={attachInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleAttach(file);
            }}
          />
          <button
            type="button"
            onClick={() => attachInputRef.current?.click()}
            disabled={attach.isPending}
            className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
          >
            + Ajouter un document
          </button>

          {selected && objectUrl && (
            <a
              href={objectUrl}
              download={selected.fileName}
              className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-ink-muted hover:bg-bg hover:text-ink"
            >
              Télécharger
            </a>
          )}

          {selected && (
            <>
              <input
                ref={replaceInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleReplace(file);
                }}
              />
              <button
                type="button"
                onClick={() => replaceInputRef.current?.click()}
                disabled={replace.isPending}
                className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-ink-muted hover:bg-bg hover:text-ink disabled:opacity-50"
              >
                Remplacer
              </button>
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={remove.isPending}
                className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-negative hover:bg-negative-soft disabled:opacity-50"
              >
                Supprimer
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="ml-auto rounded-md px-2.5 py-1.5 text-[12px] font-medium text-ink-faint hover:bg-bg hover:text-ink-muted"
          >
            {showHistory ? 'Masquer' : 'Historique'}
          </button>
        </div>

        {showHistory && (
          <div className="max-h-40 shrink-0 overflow-y-auto border-t border-border bg-bg px-4 py-2.5">
            {(auditLogQuery.data ?? []).length === 0 ? (
              <p className="text-[12px] text-ink-faint">Aucun historique.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {[...(auditLogQuery.data ?? [])].reverse().map((entry) => (
                  <li key={entry.id} className="text-[12px] text-ink-muted">
                    <span className="font-medium text-ink">
                      {ACTION_LABEL[entry.action] ?? entry.action}
                    </span>{' '}
                    — {entry.fileName} · {formatDateTime(entry.occurredAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
