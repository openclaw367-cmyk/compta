import { NavLink } from 'react-router-dom';
import type { SVGProps } from 'react';
import {
  IconBox,
  IconCalendar,
  IconChat,
  IconDocument,
  IconDownload,
  IconFlow,
  IconGauge,
  IconGrid,
  IconHome,
  IconLedger,
  IconPercent,
  IconScale,
  IconSettings,
  IconUpload,
  IconUsers,
} from './icons';

interface NavItem {
  to: string;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Tableau de bord', Icon: IconHome, end: true },
  { to: '/ecritures', label: 'Écritures', Icon: IconGrid },
  { to: '/exercices', label: 'Exercices', Icon: IconCalendar },
  { to: '/tiers', label: 'Tiers', Icon: IconUsers },
  { to: '/grand-livre', label: 'Grand livre', Icon: IconLedger },
  { to: '/import', label: 'Import Excel', Icon: IconUpload },
  { to: '/fec', label: 'Export FEC', Icon: IconDownload },
  { to: '/immobilisations', label: 'Immobilisations', Icon: IconBox },
  { to: '/tva', label: 'TVA', Icon: IconPercent },
  { to: '/liasse', label: 'Liasse fiscale', Icon: IconDocument },
  { to: '/flux-tresorerie', label: 'Flux de trésorerie', Icon: IconFlow },
  { to: '/analyse-financiere', label: 'Analyse financière', Icon: IconGauge },
  { to: '/resultat-fiscal', label: 'Résultat fiscal', Icon: IconScale },
  { to: '/assistant', label: 'Assistant', Icon: IconChat },
];

// Config screens (company profile, plan comptable, VAT rate management,
// AI/cloud config) live behind the settings hub, not the main list — see
// SettingsPage.tsx. Kept as its own, visually separated group so the main
// nav stays a workflow list, not a mix of workflow + configuration.
const SETTINGS_ITEM: NavItem = { to: '/parametres', label: 'Paramètres', Icon: IconSettings };

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors',
    isActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-bg hover:text-ink',
  ].join(' ');
}

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[13px] font-semibold text-white">
          C
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-ink">compta</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={navLinkClassName}>
            <Icon className="shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border px-3 py-2">
        <NavLink to={SETTINGS_ITEM.to} className={navLinkClassName}>
          <SETTINGS_ITEM.Icon className="shrink-0" />
          {SETTINGS_ITEM.label}
        </NavLink>
      </div>
    </aside>
  );
}
