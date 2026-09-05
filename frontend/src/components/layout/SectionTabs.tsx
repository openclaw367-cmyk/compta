import { useEffect } from 'react';
import type { ReactNode } from 'react';

export interface TabSection {
  id: string;
  label: string;
  /** A small trailing indicator — e.g. a warning dot when that section's own articulation check failed. */
  badge?: ReactNode;
}

/**
 * The shared "stop scrolling, start clicking" navigation for any page
 * whose content splits into several natural sections — see the
 * product-wide UI/UX pass this was built for. A long report used to be
 * one continuous scroll (the liasse fiscale page was the extreme case:
 * 7 tableaux stacked in a row); this renders ONE section's content at a
 * time, with a horizontal tab strip to switch — the same idea as a
 * real accountant's own paper liasse having numbered, separately-
 * flippable pages, not one endless scroll.
 *
 * Sticky under the page's own heading so the tab strip (and therefore
 * navigation) stays reachable while a long individual section is
 * itself being read — `-mx-8 px-8` cancels the page's own horizontal
 * padding so the sticky background spans edge-to-edge without content
 * peeking out the sides as it scrolls underneath.
 *
 * Two small, deliberate details: switching tabs always scrolls the
 * page's one shared scroll container (`<main>` in AppShell.tsx) back to
 * the top — without this, switching from a tab you'd scrolled halfway
 * through would land you mid-way into totally unrelated content in the
 * new tab, which reads as a bug even though nothing broke. Left/Right
 * arrow keys move between tabs while one is focused, the standard ARIA
 * tablist keyboard pattern — a small thing, but a page with 7 tabs
 * (the liasse) should feel like paging through a document, not just be
 * clickable.
 */
export function SectionTabs({
  sections,
  activeId,
  onChange,
}: {
  sections: TabSection[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [activeId]);

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = sections[(index + delta + sections.length) % sections.length];
    onChange(next.id);
    (event.currentTarget.parentElement?.children[
      (index + delta + sections.length) % sections.length
    ] as HTMLElement | undefined)?.focus();
  }

  return (
    <div className="sticky top-0 z-10 -mx-8 border-b border-border bg-bg px-8">
      <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist">
        {sections.map((section, index) => {
          const isActive = section.id === activeId;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(section.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={[
                'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-3 text-[13px] font-medium transition-colors',
                isActive ? 'text-accent' : 'text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {section.label}
              {section.badge}
              <span
                aria-hidden
                className={[
                  'absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-accent transition-opacity',
                  isActive ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
              />
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/** A small amber dot — use as a TabSection's `badge` to flag e.g. an articulation mismatch without pre-reading its content. */
export function TabWarningDot() {
  return <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />;
}
