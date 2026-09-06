import { IconCitadel } from './icons';

/**
 * The app's badge — a small accent-colored square carrying the citadel
 * glyph (see icons.tsx's own doc comment for why a citadel). Shared by
 * Sidebar.tsx and AuthLayout.tsx so the brand mark is defined once, not
 * copy-pasted per screen. `size` controls the badge's own edge length in
 * pixels — the glyph is always drawn at roughly 70% of it.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md bg-accent text-white shadow-card"
      style={{ width: size, height: size }}
    >
      <IconCitadel width={size * 0.7} height={size * 0.7} />
    </div>
  );
}
