import { Link } from 'react-router-dom';

/**
 * This screen is a configuration screen reachable from the Paramètres hub
 * (see SettingsPage.tsx) rather than the main sidebar — this breadcrumb is
 * its way back, since there's no longer a persistently-highlighted nav
 * entry for it.
 */
export function SettingsBackLink() {
  return (
    <Link
      to="/parametres"
      className="inline-flex w-fit items-center gap-1 text-[12.5px] font-medium text-ink-muted hover:text-accent"
    >
      ← Paramètres
    </Link>
  );
}
