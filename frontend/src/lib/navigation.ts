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
} from '../components/layout/icons';

export interface NavItem {
  to: string;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element;
  end?: boolean;
}

/**
 * The single source of truth for "what screens exist and what are they
 * called" — Sidebar renders this grouped, TopBar's page title resolves
 * a path against it flattened. Grouped to match how a bookkeeper
 * actually thinks about the work: daily ledger operations first, then
 * the periodic declarations/reports generated from that ledger.
 */
export const HOME_ITEM: NavItem = {
  to: '/tableau-de-bord',
  label: 'Tableau de bord',
  Icon: IconHome,
  end: true,
};

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Comptabilité',
    items: [
      { to: '/ecritures', label: 'Écritures', Icon: IconGrid },
      { to: '/grand-livre', label: 'Grand livre', Icon: IconLedger },
      { to: '/tiers', label: 'Tiers', Icon: IconUsers },
      { to: '/immobilisations', label: 'Immobilisations', Icon: IconBox },
      { to: '/exercices', label: 'Exercices', Icon: IconCalendar },
      { to: '/import', label: 'Import Excel', Icon: IconUpload },
      { to: '/fec', label: 'Export FEC', Icon: IconDownload },
    ],
  },
  {
    label: 'Déclarations & pilotage',
    items: [
      { to: '/tva', label: 'TVA', Icon: IconPercent },
      { to: '/liasse', label: 'Liasse fiscale', Icon: IconDocument },
      { to: '/resultat-fiscal', label: 'Résultat fiscal', Icon: IconScale },
      { to: '/flux-tresorerie', label: 'Flux de trésorerie', Icon: IconFlow },
      { to: '/analyse-financiere', label: 'Analyse financière', Icon: IconGauge },
    ],
  },
];

export const ASSISTANT_ITEM: NavItem = { to: '/assistant', label: 'Assistant', Icon: IconChat };

export const SETTINGS_ITEM: NavItem = { to: '/parametres', label: 'Paramètres', Icon: IconSettings };

const ALL_NAV_ITEMS: NavItem[] = [
  HOME_ITEM,
  ...NAV_GROUPS.flatMap((g) => g.items),
  ASSISTANT_ITEM,
  SETTINGS_ITEM,
];

/** Routes this app has that aren't in the nav — a detail/sub-screen reached by drilling in, not by clicking the sidebar. */
const UNLISTED_ROUTE_LABELS: { prefix: string; label: string }[] = [
  { prefix: '/immobilisations/', label: 'Immobilisations' },
  { prefix: '/assistant/parametres', label: 'Assistant — Paramètres' },
];

/** TopBar's page-title lookup — never used for routing itself, purely a display label. */
export function labelForPath(pathname: string): string | null {
  const exact = ALL_NAV_ITEMS.find((item) => item.to === pathname);
  if (exact) return exact.label;
  const unlisted = UNLISTED_ROUTE_LABELS.find((r) => pathname.startsWith(r.prefix));
  return unlisted?.label ?? null;
}
