import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccounts } from '../../api/queries';
import { ASSISTANT_ITEM, HOME_ITEM, NAV_GROUPS, SETTINGS_ITEM, type NavItem } from '../../lib/navigation';
import { IconSearch } from '../layout/icons';

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

type PaletteResult =
  | { kind: 'page'; key: string; label: string; hint: string; to: string }
  | { kind: 'account'; key: string; label: string; hint: string; to: string };

/** Accent-insensitive matching ("ecritures" should find "Écritures") — strips
 *  Unicode combining diacritical marks (U+0300-U+036F) after NFD decomposition. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Ctrl/Cmd+K — jump to any page, or any account/tiers by number or
 * name, without touching the sidebar. See the product-wide UI/UX pass
 * this was built for: this app has 18+ nav destinations plus every
 * account/tiers only reachable by drilling into Tiers/Grand livre one
 * at a time — a fuzzy "go to anything" palette is the fastest way
 * through both. Pages match instantly (a static list, no request);
 * accounts reuse the SAME cached `['accounts']` query every other
 * screen already warms (Tiers, the journal grid's own combobox, ...),
 * so opening the palette is never itself a new network round trip once
 * any other screen has loaded once this session.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const accountsQuery = useAccounts();

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
      setHighlighted(0);
      // Wait one frame — the input isn't mounted yet on the same tick this effect fires.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

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
          key: item.to,
          label: item.label,
          hint,
          to: item.to,
        }),
      ),
      ...EXTRA_DESTINATIONS.map(
        (d): PaletteResult => ({ kind: 'page', key: d.to, label: d.label, hint: d.hint, to: d.to }),
      ),
    ];
  }, []);

  const accountResults = useMemo((): PaletteResult[] => {
    return (accountsQuery.data ?? []).map(
      (account): PaletteResult => ({
        kind: 'account',
        key: account.id,
        label: `${account.number} — ${account.label}`,
        hint: account.isAuxiliary ? 'Tiers' : 'Compte',
        to: `/grand-livre?compte=${account.id}`,
      }),
    );
  }, [accountsQuery.data]);

  const results = useMemo((): PaletteResult[] => {
    const q = normalize(query.trim());
    if (q === '') return pageResults.slice(0, 8);
    const matches = (r: PaletteResult) => normalize(r.label).includes(q) || normalize(r.hint).includes(q);
    return [...pageResults.filter(matches), ...accountResults.filter(matches)].slice(0, 20);
  }, [query, pageResults, accountResults]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  function activate(result: PaletteResult) {
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
                placeholder="Aller à une page, un compte, un tiers…"
                className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
              />
              <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-ink-faint">
                Échap
              </kbd>
            </div>

            <div className="max-h-80 overflow-y-auto py-1.5">
              {results.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-ink-faint">
                  Aucun résultat pour « {query} ».
                </p>
              ) : (
                results.map((result, index) => (
                  <button
                    key={`${result.kind}-${result.key}`}
                    type="button"
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => activate(result)}
                    className={[
                      'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] transition-colors',
                      index === highlighted ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-bg',
                    ].join(' ')}
                  >
                    <span className="truncate">{result.label}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-faint">{result.hint}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
