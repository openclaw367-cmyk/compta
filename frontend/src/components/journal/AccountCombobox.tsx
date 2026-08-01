import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Account } from '../../api/types';
import { ApiError } from '../../api/client';

function accountLabel(account: Account): string {
  return `${account.number} — ${account.label}`;
}

interface AccountComboboxProps {
  accounts: Account[];
  value: string | null;
  onSelect: (accountId: string) => void;
  placeholder?: string;
  onNavigateNext?: () => void;
  disabled?: boolean;
  /**
   * When set, the dropdown offers "+ {createLabel} « query »" as its last
   * option whenever there's typed text. Resolving it (server round-trip)
   * must return the created Account so it can be selected immediately,
   * same as picking an existing one.
   */
  onCreateNew?: (label: string) => Promise<Account>;
  createLabel?: string;
}

/**
 * Inline CompteNum autocomplete for one grid cell. Filters by number
 * prefix or label substring; ArrowDown/Up move the highlighted option
 * (the create-new option, when shown, is the last one), Enter selects it,
 * Escape closes without changing the selection. When closed, Tab/Enter
 * behave like a normal text field so the grid's own tab order and
 * row-add-on-Enter keep working.
 */
export const AccountCombobox = forwardRef<HTMLInputElement, AccountComboboxProps>(
  function AccountCombobox(
    {
      accounts,
      value,
      onSelect,
      placeholder,
      onNavigateNext,
      disabled,
      onCreateNew,
      createLabel = 'nouveau',
    }: AccountComboboxProps,
    ref,
  ) {
    const selected = useMemo(() => accounts.find((a) => a.id === value) ?? null, [accounts, value]);
    const [query, setQuery] = useState(selected ? accountLabel(selected) : '');
    const [isOpen, setIsOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // The blur handler below fires synchronously when onNavigateNext moves
    // focus to the next cell, before React has re-rendered with the just-
    // selected value — its setTimeout would otherwise close over a stale
    // `selected` (still null) and blank the field back out a moment after
    // a keyboard selection. Reading through a ref instead always sees the
    // latest value when the timeout actually runs.
    const selectedRef = useRef(selected);
    selectedRef.current = selected;

    useEffect(() => {
      setQuery(selected ? accountLabel(selected) : '');
    }, [selected]);

    const matches = useMemo(() => {
      if (!isOpen) return [];
      const needle = query.trim().toLowerCase();
      if (needle === '' || (selected && query === accountLabel(selected))) {
        return accounts.slice(0, 30);
      }
      return accounts
        .filter((a) => a.number.startsWith(needle) || a.label.toLowerCase().includes(needle))
        .slice(0, 30);
    }, [accounts, query, isOpen, selected]);

    const trimmedQuery = query.trim();
    const showCreateOption = Boolean(onCreateNew) && trimmedQuery !== '' && !creating;
    // The create option is an extra highlightable entry past the matches.
    const createOptionIndex = matches.length;
    const optionCount = matches.length + (showCreateOption ? 1 : 0);

    function choose(account: Account) {
      onSelect(account.id);
      setQuery(accountLabel(account));
      setIsOpen(false);
    }

    async function handleCreateNew() {
      if (!onCreateNew || trimmedQuery === '') return;
      setCreating(true);
      setCreateError(null);
      try {
        const created = await onCreateNew(trimmedQuery);
        choose(created);
      } catch (error) {
        setCreateError(error instanceof ApiError ? error.message : 'La création a échoué.');
      } finally {
        setCreating(false);
      }
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
        setHighlighted((i) => Math.min(i + 1, Math.max(optionCount - 1, 0)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((i) => Math.max(i - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (showCreateOption && highlighted === createOptionIndex) {
          void handleCreateNew();
        } else {
          const match = matches[highlighted];
          if (match) {
            choose(match);
            onNavigateNext?.();
          }
        }
      } else if (event.key === 'Escape') {
        setIsOpen(false);
        setQuery(selected ? accountLabel(selected) : '');
      } else if (event.key === 'Tab') {
        setIsOpen(false);
      }
    }

    return (
      <div className="relative">
        <input
          ref={ref}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          disabled={disabled}
          className="w-full bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint disabled:text-ink-faint"
          placeholder={placeholder ?? 'N° compte'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setHighlighted(0);
            setCreateError(null);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            // Let a click on an option register before we close and reset.
            window.setTimeout(() => {
              setIsOpen(false);
              const current = selectedRef.current;
              setQuery(current ? accountLabel(current) : '');
            }, 120);
          }}
          onKeyDown={handleKeyDown}
        />
        {isOpen && creating && (
          <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink-faint shadow-lg">
            Création…
          </div>
        )}
        {isOpen && !creating && accounts.length === 0 && !showCreateOption && (
          <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink-faint shadow-lg">
            Aucun compte disponible.
          </div>
        )}
        {isOpen && !creating && (matches.length > 0 || showCreateOption) && (
          <ul
            role="listbox"
            className="absolute left-0 top-full z-20 mt-1 max-h-64 w-80 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
          >
            {matches.map((account, index) => (
              <li
                key={account.id}
                role="option"
                aria-selected={index === highlighted}
                className={[
                  'cursor-pointer px-3 py-1.5 text-[13px] tabular-nums',
                  index === highlighted ? 'bg-accent-soft text-accent' : 'text-ink',
                ].join(' ')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(account);
                  onNavigateNext?.();
                }}
                onMouseEnter={() => setHighlighted(index)}
              >
                <span className="font-medium">{account.number}</span>
                <span className="text-ink-muted"> — {account.label}</span>
              </li>
            ))}
            {showCreateOption && (
              <li
                role="option"
                aria-selected={highlighted === createOptionIndex}
                className={[
                  'cursor-pointer border-t border-border px-3 py-1.5 text-[13px] font-medium',
                  highlighted === createOptionIndex ? 'bg-accent-soft text-accent' : 'text-accent',
                ].join(' ')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void handleCreateNew();
                }}
                onMouseEnter={() => setHighlighted(createOptionIndex)}
              >
                + {createLabel} « {trimmedQuery} »
              </li>
            )}
          </ul>
        )}
        {createError && (
          <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-negative-soft bg-negative-soft px-3 py-2 text-[12.5px] text-negative shadow-lg">
            {createError}
          </div>
        )}
      </div>
    );
  },
);
