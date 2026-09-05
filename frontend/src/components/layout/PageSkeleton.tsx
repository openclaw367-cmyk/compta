/**
 * A shape-matched loading placeholder, for the several admin/report
 * pages that used to just show a bare "Chargement…" string while every
 * other page in the app already showed a real pulsing skeleton (see
 * e.g. GrandLivrePage.tsx's own inline one, which this generalizes) —
 * a small but real inconsistency a careful user notices immediately: a
 * plain word feels like an unfinished screen, a shape-matched skeleton
 * feels like the content is already there and about to arrive.
 *
 * `maxWidth` matches the page's own real content container so nothing
 * visibly shifts width the moment the real content replaces this.
 */
export function PageSkeleton({
  maxWidth = 'max-w-3xl',
  blocks = 1,
}: {
  maxWidth?: 'max-w-2xl' | 'max-w-3xl' | 'max-w-4xl' | 'max-w-5xl';
  blocks?: number;
}) {
  return (
    <div className={`mx-auto flex ${maxWidth} flex-col gap-5 px-8 py-8`}>
      <div className="flex flex-col gap-2">
        <div className="h-6 w-40 animate-pulse rounded-md bg-border" />
        <div className="h-3.5 w-72 animate-pulse rounded-md bg-border" />
      </div>
      {Array.from({ length: blocks }, (_, i) => (
        <div key={i} className="h-40 w-full animate-pulse rounded-lg bg-border" />
      ))}
    </div>
  );
}
