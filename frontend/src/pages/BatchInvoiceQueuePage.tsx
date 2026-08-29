import { useState } from 'react';
import { useAccounts, useJournals } from '../api/queries';
import { useAppContext } from '../context/appContextStore';
import { EcritureEditor } from '../components/journal/EcritureEditor';
import { IconPaperclip, IconUpload } from '../components/layout/icons';

type ItemStatus = 'EN_ATTENTE' | 'ENREGISTREE' | 'IGNOREE';

interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `q${idSeq}`;
}

// Matches EcritureEditor's own "Joindre un document" input exactly (see
// its own accept attribute) — a batch item is, structurally, the same
// kind of attachment a human already picks one at a time there. Not
// widened to include .xlsx/.xls (which InvoiceExtractionService CAN
// parse) since the existing single-item flow doesn't offer that either
// — staying consistent with the already-shipped, already-reviewed set
// rather than independently deciding to widen it here.
const ACCEPTED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png';

const STATUS_LABELS: Record<ItemStatus, string> = {
  EN_ATTENTE: 'En attente',
  ENREGISTREE: 'Enregistrée',
  IGNOREE: 'Ignorée',
};

const STATUS_CLASSES: Record<ItemStatus, string> = {
  EN_ATTENTE: 'bg-bg text-ink-faint',
  ENREGISTREE: 'bg-positive-soft text-positive',
  IGNOREE: 'bg-bg text-ink-faint',
};

/**
 * Batch invoice review queue (design pass approved, see
 * specs/roadmap.md §2 and CLAUDE.md "Batch invoice review queue"). An
 * orchestration layer over already-shipped pieces — every backend call
 * is one already-existing, already-verified endpoint
 * (`/documents/extract`, `/documents/suggest-accounts`, `POST
 * /entries`, `POST /entries/:id/documents`), and every per-item review
 * step is `EcritureEditor`'s own existing new-entry flow, seeded per
 * file via its new `initialFile` prop. Nothing here is a new write path
 * or a new validation gate.
 *
 * **Client-side only, by design** (see the roadmap decision this was
 * built from): files stay as in-memory `File` objects in this page's
 * own state. Nothing is persisted server-side until a specific item's
 * own "Enregistrer" click creates a real écriture — closing the tab
 * loses only genuinely-unconfirmed items, never a partial write.
 * **No bulk/automatic confirmation** — every item requires its own
 * individual click, matching the roadmap's own stricter wording for
 * this specific feature ("must not auto-post, no matter how 'obviously
 * correct' a batch result looks").
 *
 * **Lazy per-item extraction, not eager-on-drop**: only the currently
 * SELECTED item's `EcritureEditor` is mounted (keyed by the item's own
 * id, forcing a fresh instance per selection — same `key={...}` idiom
 * `JournalEntriesPage.tsx` already uses for its own new/edit editor).
 * A large drop never fires N simultaneous extraction calls; the rail
 * therefore shows filename + status only, never a preview of amounts,
 * since those aren't known until an item is actually opened.
 *
 * **Revisiting an already-opened-but-unsaved item resets its editor
 * state** (a fresh mount re-runs extraction from scratch) — a
 * deliberate simplification, not a bug: nothing is durable per item
 * until that item's own confirm click, consistent with the
 * client-side-only decision above.
 */
export function BatchInvoiceQueuePage() {
  const { fiscalYearId } = useAppContext();
  const journalsQuery = useJournals();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const achatsJournal = (journalsQuery.data ?? []).find((j) => j.type === 'ACHATS');

  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const pendingCount = items.filter((item) => item.status === 'EN_ATTENTE').length;

  function addFiles(fileList: FileList) {
    const added: QueueItem[] = Array.from(fileList).map((file) => ({
      id: nextId(),
      file,
      status: 'EN_ATTENTE',
    }));
    if (added.length === 0) return;
    setItems((prev) => [...prev, ...added]);
    setSelectedId((current) => current ?? added[0].id);
  }

  function markStatus(id: string, status: ItemStatus) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
  }

  function advanceToNextPending(afterId: string) {
    const index = items.findIndex((item) => item.id === afterId);
    const next = items.slice(index + 1).find((item) => item.status === 'EN_ATTENTE');
    setSelectedId(next ? next.id : null);
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Revue de factures</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Déposez plusieurs factures pour créer une écriture par facture — chacune reste à
          confirmer individuellement, rien n'est jamais enregistré automatiquement.
        </p>
      </header>

      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-border bg-surface px-4 py-3.5 text-[13px] font-medium text-ink-muted hover:border-accent hover:text-accent">
        <IconUpload width={15} height={15} />
        Déposer des factures (PDF, JPG, PNG)
        <input
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {pendingCount > 0 && (
          <span className="ml-auto rounded-full bg-bg px-2 py-0.5 text-[12px] text-ink-faint">
            {pendingCount} en attente
          </span>
        )}
      </label>

      {!achatsJournal && journalsQuery.data && (
        <p className="text-[13px] text-negative">
          Aucun journal des achats n'existe pour cette société — impossible de créer des écritures
          depuis cette file.
        </p>
      )}
      {!fiscalYearId && (
        <p className="text-[13px] text-negative">
          Sélectionnez d'abord un exercice (en haut de l'écran).
        </p>
      )}

      {items.length > 0 && (
        <div className="flex gap-6">
          <aside className="flex w-64 shrink-0 flex-col gap-1">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={[
                  'flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12.5px]',
                  item.id === selectedId
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-border bg-surface text-ink-muted hover:border-accent/50',
                ].join(' ')}
              >
                <IconPaperclip width={12} height={12} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${STATUS_CLASSES[item.status]}`}
                >
                  {STATUS_LABELS[item.status]}
                </span>
              </button>
            ))}
          </aside>

          <div className="min-w-0 flex-1">
            {selected && achatsJournal && fiscalYearId ? (
              <EcritureEditor
                key={selected.id}
                journalId={achatsJournal.id}
                fiscalYearId={fiscalYearId}
                accounts={accounts}
                existing={null}
                initialFile={selected.file}
                onSaved={() => {
                  markStatus(selected.id, 'ENREGISTREE');
                  advanceToNextPending(selected.id);
                }}
                onCancel={() => {
                  markStatus(selected.id, 'IGNOREE');
                  advanceToNextPending(selected.id);
                }}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
                Sélectionnez une facture dans la liste.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
