import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccounts, useEntrySearch } from '../../api/queries';
import { useAppContext } from '../../context/appContextStore';
import { formatMoneyFr } from '../../lib/money';
import { ASSISTANT_ITEM, HOME_ITEM, NAV_GROUPS, SETTINGS_ITEM, type NavItem } from '../../lib/navigation';
import { IconSearch, IconX } from '../layout/icons';

interface ExtraDestination {
  to: string;
  label: string;
  hint: string;
}

/** Reachable by drilling in, not from the sidebar — worth surfacing here since that's exactly the point of a command palette. */
const EXTRA_DESTINATIONS: ExtraDestination[] = [
  { to: '/parametres/nouvelle-societe', label: 'Nouvelle société', hint: 'Paramètres' },
  { to: '/parametres/membres', label: 'Membres', hint: 'Paramètres' },
  { to: '/comptes', label: 'Comptes & journaux', hint: 'Paramètres' },
];

/** Keystrokes settle for this long before the (server-side) écriture search fires — pages/
 *  comptes stay instant either way, since those are filtered client-side from an already-warm cache. */
const SEARCH_DEBOUNCE_MS = 250;

/** Per-viewer, per-company convenience persisted to localStorage — same "not the place for
 *  anything that must persist reliably or be shared between viewers" discipline as the theme/
 *  density preferences and the onboarding checklist's own dismissal flag. Company-scoped since a
 *  past écriture/account search from one dossier is meaningless (and potentially confusing) in
 *  another. */
const HISTORY_KEY_PREFIX = 'compta:searchHistory:';
const SEARCH_HISTORY_LIMIT = 6;
/** Below this length a query is a stray keystroke, not something worth remembering. */
const MIN_HISTORY_TERM_LENGTH = 2;

function loadHistory(companyId: string | null | undefined): string[] {
  if (!companyId) return [];
  const raw = localStorage.getItem(HISTORY_KEY_PREFIX + companyId);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(companyId: string | null | undefined, terms: string[]): void {
  if (!companyId) return;
  localStorage.setItem(HISTORY_KEY_PREFIX + companyId, JSON.stringify(terms));
}

type ResultGroup = 'Récent' | 'Pages' | 'Comptes' | 'Écritures';

type PaletteResult = {
  kind: 'history' | 'page' | 'account' | 'ecriture';
  group: ResultGroup;
  key: string;
  label: string;
  hint: string;
  to: string;
};

/** Accent-insensitive matching ("ecritures" should find "Écritures") — strips
 *  Unicode combining diacritical marks (U+0300-U+036F) after NFD decomposition. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function formatDateFr(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Ctrl/Cmd+K — jump to any page, account/tiers, or écriture, without
 * touching the sidebar. See the product-wide UI/UX pass this was built
 * for. Pages and accounts match instantly, entirely client-side, from
 * data already cached (a static list; the same `['accounts']` query
 * every other screen warms). Écritures are different on purpose — a
 * company can have thousands, so that's a real, debounced backend
 * search (see CLAUDE.md "Search — écritures by libellé/amount"), kept
 * in its own clearly-labeled group so it can never be confused with
 * (or crowd out) the instant page/compte results above it. Opening the
 * palette with an empty query shows a "Récent" group of past search
 * terms (see CLAUDE.md's same section) ahead of the default page list —
 * clicking one re-populates the query rather than navigating, since a
 * remembered term is a starting point to search again, not a fixed
 * destination.
 */
export function CommandPalette() {
  const { companyId } = useAppContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const accountsQuery = useAccounts();

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const entrySearchQuery = useEntrySearch(debouncedQuery);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setDebouncedQuery('');
      setHighlighted(0);
      setHistory(loadHistory(companyId));
      // Wait one frame — the input isn't mounted yet on the same tick this effect fires.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, companyId]);

  function recordHistory(term: string) {
    const trimmed = term.trim();
    if (trimmed.length < MIN_HISTORY_TERM_LENGTH) return;
    setHistory((prev) => {
      const next = [
        trimmed,
        ...prev.filter((h) => normalize(h) !== normalize(trimmed)),
      ].slice(0, SEARCH_HISTORY_LIMIT);
      saveHistory(companyId, next);
      return next;
    });
  }

  function removeHistoryEntry(term: string) {
    setHistory((prev) => {
      const next = prev.filter((h) => h !== term);
      saveHistory(companyId, next);
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    saveHistory(companyId, []);
  }

  const pageResults = useMemo((): PaletteResult[] => {
    const allPages: { item: NavItem; hint: string }[] = [
      { item: HOME_ITEM, hint: 'Accueil' },
      ...NAV_GROUPS.flatMap((group) => group.items.map((item) => ({ item, hint: group.label }))),
      { item: ASSISTANT_ITEM, hint: 'Assistant' },
      { item: SETTINGS_ITEM, hint: 'Paramètres' },
    ];
    return [
      ...allPages.map(
        ({ item, hint }): PaletteResult => ({
          kind: 'page',
          group: 'Pages',
          key: item.to,
          label: item.label,
          hint,
          to: item.to,
        }),
      ),
      ...EXTRA_DESTINATIONS.map(
        (d): PaletteResult => ({
          kind: 'page',
          group: 'Pages',
          key: d.to,
          label: d.label,
          hint: d.hint,
          to: d.to,
        }),
      ),
    ];
  }, []);

  const accountResults = useMemo((): PaletteResult[] => {
    return (accountsQuery.data ?? []).map(
      (account): PaletteResult => ({
        kind: 'account',
        group: 'Comptes',
        key: account.id,
        label: `${account.number} — ${account.label}`,
        hint: account.isAuxiliary ? 'Tiers' : 'Compte',
        to: `/grand-livre?compte=${account.id}`,
      }),
    );
  }, [accountsQuery.data]);

  const q = normalize(query.trim());
  const matches = (r: PaletteResult) => normalize(r.label).includes(q) || normalize(r.hint).includes(q);

  const historyMatches: PaletteResult[] =
    q === ''
      ? history.map((term) => ({
          kind: 'history',
          group: 'Récent',
          key: `history-${term}`,
          label: term,
          hint: '',
          to: '',
        }))
      : [];
  const pageMatches = q === '' ? pageResults.slice(0, 8) : pageResults.filter(matches).slice(0, 8);
  const accountMatches = q === '' ? [] : accountResults.filter(matches).slice(0, 8);

  const entrySearch = entrySearchQuery.data;
  const ecritureMatches = useMemo((): PaletteResult[] => {
    if (q === '' || !entrySearch) return [];
    return entrySearch.results.map(
      (r): PaletteResult => ({
        kind: 'ecriture',
        group: 'Écritures',
        key: r.id,
        label: r.libelle,
        hint:
          `${formatDateFr(r.ecritureDate)} · ${r.journalCode}` +
          (r.pieceRef && r.pieceRef.toUpperCase() !== 'NA' ? ` · Pièce ${r.pieceRef}` : '') +
          ` · ${formatMoneyFr(r.amount)}` +
          (r.validatedAt ? '' : ' · Brouillon'),
        to: `/ecritures?journal=${r.journalId}&ecriture=${r.id}`,
      }),
    );
  }, [q, entrySearch]);

  // Gated on q !== '' too, not just entrySearch being truthy — useEntrySearch's own
  // placeholderData keeps the PREVIOUS (non-empty-query) result cached even once the query is
  // cleared and the query is disabled, so entrySearch can be stale/truthy here for a beat after
  // clearing the input. Without this guard the "+N résultats" footer would linger.
  const remainingEcritureCount =
    q !== '' && entrySearch ? entrySearch.totalCount - ecritureMatches.length : 0;

  // Small, bounded arrays (max ~30 items total) — a plain concat every
  // render is simpler and cheaper than fighting useMemo's referential-
  // equality requirements for four independently-computed slices.
  const results = [...historyMatches, ...pageMatches, ...accountMatches, ...ecritureMatches];

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  function activate(result: PaletteResult) {
    if (result.kind === 'history') {
      // Re-populate and search again immediately — skip the debounce,
      // since this is already a deliberate, explicit choice, not a
      // mid-typing keystroke.
      setQuery(result.label);
      setDebouncedQuery(result.label);
      return;
    }
    recordHistory(query);
    navigate(result.to);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = results[highlighted];
      if (chosen) activate(chosen);
    }
  }

  let renderedGroup: ResultGroup | null = null;

  return (
    <>
      <button
        type="button"
        title="Rechercher (Ctrl+K)"
        onClick={() => setOpen(true)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-ink-faint transition-colors hover:border-accent hover:text-accent"
      >
        <IconSearch width={13} height={13} />
        <span className="sr-only">Rechercher</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[15vh]"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Rechercher"
            className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <IconSearch className="shrink-0 text-ink-faint" width={16} height={16} />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Page, compte, écriture (libellé, pièce ou montant)…"
                className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
              />
              <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-ink-faint">
                Échap
              </kbd>
            </div>

            <div className="max-h-96 overflow-y-auto py-1.5">
              {results.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-ink-faint">
                  {q !== '' && q.length < 2
                    ? 'Continuez à taper pour chercher dans les écritures…'
                    : `Aucun résultat pour « ${query} ».`}
                </p>
              ) : (
                results.map((result, index) => {
                  const showHeader = result.group !== renderedGroup;
                  renderedGroup = result.group;
                  return (
                    <div key={`${result.kind}-${result.key}`}>
                      {showHeader && (
                        <div className="flex items-center justify-between px-4 pb-1 pt-2.5 first:pt-1.5">
                          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
                            {result.group}
                          </p>
                          {result.kind === 'history' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                clearHistory();
                              }}
                              className="text-[11px] text-ink-faint hover:text-accent"
                            >
                              Tout effacer
                            </button>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onMouseEnter={() => setHighlighted(index)}
                        onClick={() => activate(result)}
                        className={[
                          'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] transition-colors',
                          index === highlighted ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-bg',
                        ].join(' ')}
                      >
                        <span className="truncate">{result.label}</span>
                        {result.kind === 'history' ? (
                          <span
                            role="button"
                            tabIndex={-1}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeHistoryEntry(result.label);
                            }}
                            className="shrink-0 rounded p-0.5 text-ink-faint hover:text-negative"
                            title="Supprimer cette recherche"
                          >
                            <IconX width={12} height={12} />
                          </span>
                        ) : (
                          <span className="shrink-0 text-[11.5px] text-ink-faint">{result.hint}</span>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
              {remainingEcritureCount > 0 && (
                <p className="px-4 pb-2 pt-1 text-[11.5px] text-ink-faint">
                  +{remainingEcritureCount} résultat{remainingEcritureCount > 1 ? 's' : ''} — affinez
                  votre recherche.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
