import { useAppContext } from '../../context/appContextStore';

/**
 * The app-wide company + fiscal-year selector — always visible, above
 * every screen's own content (see AppShell.tsx). Every page that reads
 * `useAppContext()` for its default fiscal year, and every API call
 * (scoped by `x-company-id`, set centrally in api/client.ts), reflects
 * whatever is chosen here. See CLAUDE.md "Navigation" for why this
 * exists: the app was multi-tenant/multi-year from day one but had no
 * way to actually reach a second company or year before this.
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

  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-4 border-b border-border bg-surface px-6">
      {fiscalYears.length > 0 && (
        <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
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
        <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
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
          <span className="text-[13px] font-medium text-ink">{currentCompany.name}</span>
        )
      )}
    </header>
  );
}
