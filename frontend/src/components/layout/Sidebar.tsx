import { Link, NavLink } from 'react-router-dom';
import { ASSISTANT_ITEM, HOME_ITEM, NAV_GROUPS, SETTINGS_ITEM, type NavItem } from '../../lib/navigation';
import { BrandMark } from './BrandMark';

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return [
    'group relative flex items-center gap-2.5 rounded-md py-2 pl-3.5 pr-3 text-[13.5px] font-medium transition-colors',
    isActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-bg hover:text-ink',
  ].join(' ');
}

function NavItemLink({ to, label, Icon, end }: NavItem) {
  return (
    <NavLink key={to} to={to} end={end} className={navLinkClassName}>
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={[
              'absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
          />
          <Icon className="shrink-0" />
          {label}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <Link to="/tableau-de-bord" className="flex h-16 items-center gap-2 px-6">
        <BrandMark size={28} />
        <span className="text-[15px] font-semibold tracking-tight text-ink">Citaledge</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <NavItemLink {...HOME_ITEM} />
        </div>

        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div className="px-3.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavItemLink key={item.to} {...item} />
            ))}
          </div>
        ))}

        <div className="flex flex-col gap-0.5">
          <NavItemLink {...ASSISTANT_ITEM} />
        </div>
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border px-3 py-2">
        <NavItemLink {...SETTINGS_ITEM} />
      </div>
    </aside>
  );
}
