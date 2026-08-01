export function PlaceholderPage({
  title,
  message,
  kind,
}: {
  title: string;
  message: string;
  kind: 'not-built' | 'not-implemented';
}) {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-md text-center">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {kind === 'not-built' ? 'Écran à venir' : 'Non implémenté'}
        </p>
        <h1 className="mb-2 text-[19px] font-semibold text-ink">{title}</h1>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">{message}</p>
      </div>
    </div>
  );
}
