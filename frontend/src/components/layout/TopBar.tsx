import { useLocation } from 'react-router-dom';
import { useAppContext } from '../../context/appContextStore';
import { usePreferences, type ThemePreference } from '../../context/preferencesStore';
import { labelForPath } from '../../lib/navigation';
import { IconMonitor, IconMoon, IconSun } from './icons';

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof IconSun }[] = [
  { value: 'light', label: 'Thème clair', Icon: IconSun },
  { value: 'system', label: 'Thème système', Icon: IconMonitor },
  { value: 'dark', label: 'Thème sombre', Icon: IconMoon },
];

/**
 * The app-wide company + fiscal-year selector, page title, and a quick
 * theme toggle — always visible, above every screen's own content (see
 * AppShell.tsx). Every page that reads `useAppContext()` for its default
 * fiscal year, and every API call (scoped by `x-company-id`, set
 * centrally in api/client.ts), reflects whatever is chosen here. See
 * CLAUDE.md "Navigation" for why the company/year selector exists: the
 * app was multi-tenant/multi-year from day one but had no way to
 * actually reach a second company or year before this.
 *
 * The company control only renders as a real `<select>` once a second
 * company actually exists — with exactly one (the common case today),
 * showing a picker with nothing to pick would just be noise; a plain
 * label still names the company so it's never ambiguous which dossier
 * is active.
 */
export function TopBar() {
  const {
    companies,
    companyId,
    currentCompany,
    setCompanyId,
    fiscalYears,
    fiscalYearId,
    setFiscalYearId,
  } = useAppContext();
  const { theme, setTheme } = usePreferences();
  const location = useLocation();
  const pageTitle = labelForPath(location.pathname);

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-6">
      {/* Chrome-level wayfinding, not the page's own heading (each page
          renders its own <h1>) — stays visible once that heading has
          scrolled out of view. */}
      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ink">
        {pageTitle}
      </span>

      {fiscalYears.length > 0 && (
        <label className="flex shrink-0 items-center gap-2 text-[12.5px] text-ink-muted">
          Exercice
          <select
            value={fiscalYearId ?? ''}
            onChange={(e) => setFiscalYearId(e.target.value)}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          >
            {fiscalYears.map((fy) => (
              <option key={fy.id} value={fy.id}>
                {fy.label}
                {fy.closedAt ? ' (clôturé)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {companies.length > 1 ? (
        <label className="flex shrink-0 items-center gap-2 text-[12.5px] text-ink-muted">
          Société
          <select
            value={companyId ?? ''}
            onChange={(e) => setCompanyId(e.target.value)}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        currentCompany && (
          <span className="shrink-0 text-[13px] font-medium text-ink">{currentCompany.name}</span>
        )
      )}

      <div
        role="radiogroup"
        aria-label="Thème"
        className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-bg p-0.5"
      >
        {THEME_OPTIONS.map(({ value, label, Icon }) => {
          const isActive = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={isActive}
              title={label}
              onClick={() => setTheme(value)}
              className={[
                'flex h-6 w-6 items-center justify-center rounded transition-colors',
                isActive
                  ? 'bg-surface text-accent shadow-card'
                  : 'text-ink-faint hover:text-ink-muted',
              ].join(' ')}
            >
              <Icon width={14} height={14} />
              <span className="sr-only">{label}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
}
