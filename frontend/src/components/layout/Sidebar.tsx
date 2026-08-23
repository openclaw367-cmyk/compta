import { NavLink } from 'react-router-dom';
import type { SVGProps } from 'react';
import {
  IconBox,
  IconBuilding,
  IconCalendar,
  IconChat,
  IconDocument,
  IconDownload,
  IconFlow,
  IconGauge,
  IconGrid,
  IconHome,
  IconLedger,
  IconList,
  IconPercent,
  IconScale,
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
  { to: '/comptes', label: 'Comptes & journaux', Icon: IconList },
  { to: '/societe', label: 'Société', Icon: IconBuilding },
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
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors',
                isActive
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-muted hover:bg-bg hover:text-ink',
              ].join(' ')
            }
          >
            <Icon className="shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
