import { useSearchParams } from 'react-router-dom';

/**
 * Backs a page's <SectionTabs> selection with a `?section=` URL param —
 * same "state lives in the URL" convention this app already uses for
 * deep-linkable views (GrandLivrePage's `?compte=&periodStart=`,
 * InvoicingPage's `?invoice=`). Makes a specific tab bookmarkable/
 * shareable, and `replace: true` keeps switching tabs from spamming
 * browser history the way switching a filter wouldn't either.
 *
 * Falls back to `defaultId` when the param is missing OR names a
 * section that isn't valid for the current data (e.g. a régime réel
 * simplifié company has no "2054" tab) — never a blank/broken screen.
 */
export function useSectionTab(validIds: string[], defaultId: string): [string, (id: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get('section');
  const active = param && validIds.includes(param) ? param : defaultId;

  function setActive(id: string) {
    const next = new URLSearchParams(searchParams);
    next.set('section', id);
    setSearchParams(next, { replace: true });
  }

  return [active, setActive];
}
