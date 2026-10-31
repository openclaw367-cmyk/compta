import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Company } from '../../api/types';

interface CompanySwitcherProps {
  companies: Company[];
  value: string | null;
  onSelect: (companyId: string) => void;
}

/**
 * Type-to-filter company switcher — replaces TopBar's former flat
 * `<select>`, reusing the exact combobox idiom `AccountCombobox.tsx`
 * already established (filter-as-you-type, ArrowUp/Down + Enter,
 * Escape reverts) rather than inventing a second interaction pattern.
 * See CLAUDE.md "Multi-client / cabinet management" — item 1 of that
 * section's own phased "cheapest to most work" plan: pure UI, zero
 * backend change, meant to scale past the handful of companies a flat
 * `<select>` was still tolerable for.
 */
export function CompanySwitcher({ companies, value, onSelect }: CompanySwitcherProps) {
  const selected = useMemo(() => companies.find((c) => c.id === value) ?? null, [companies, value]);
  const [query, setQuery] = useState(selected?.name ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  // Mirrors AccountCombobox's own ref-vs-state-closure fix: the blur
  // handler's setTimeout must see the LATEST selection, not a stale one
  // closed over at the moment the timeout was scheduled.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    setQuery(selected?.name ?? '');
  }, [selected]);

  const matches = useMemo(() => {
    if (!isOpen) return [];
    const needle = query.trim().toLowerCase();
    if (needle === '' || (selected && query === selected.name)) {
      return companies;
    }
    return companies.filter((c) => c.name.toLowerCase().includes(needle));
  }, [companies, query, isOpen, selected]);

  function choose(company: Company) {
    onSelect(company.id);
    setQuery(company.name);
    setIsOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        setIsOpen(true);
        setHighlighted(0);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const match = matches[highlighted];
      if (match) choose(match);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      setQuery(selected?.name ?? '');
    } else if (event.key === 'Tab') {
      setIsOpen(false);
    }
  }

  return (
    <div className="relative w-44 shrink-0">
      <input
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-label="Société"
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        placeholder="Rechercher une société…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          // Let a click on an option register before we close and reset.
          window.setTimeout(() => {
            setIsOpen(false);
            setQuery(selectedRef.current?.name ?? '');
          }, 120);
        }}
        onKeyDown={handleKeyDown}
      />
      {isOpen && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-elevated"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-1.5 text-[13px] text-ink-faint">Aucune société trouvée.</li>
          ) : (
            matches.map((company, index) => (
              <li
                key={company.id}
                role="option"
                aria-selected={index === highlighted}
                className={[
                  'cursor-pointer px-3 py-1.5 text-[13px]',
                  index === highlighted ? 'bg-accent-soft text-accent' : 'text-ink',
                ].join(' ')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(company);
                }}
                onMouseEnter={() => setHighlighted(index)}
              >
                <span className="font-medium">{company.name}</span>
                <span className="text-ink-faint"> — {company.jurisdiction}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
