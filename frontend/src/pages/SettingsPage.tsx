import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCompany, useCloudCredentials } from '../api/queries';
import {
  usePreferences,
  type DensityPreference,
  type ThemePreference,
} from '../context/preferencesStore';
import { ASSISTANT_ITEM, HOME_ITEM, NAV_GROUPS } from '../lib/navigation';
import {
  IconBuilding,
  IconChat,
  IconList,
  IconMonitor,
  IconMoon,
  IconPercent,
  IconPlus,
  IconSun,
} from '../components/layout/icons';

const REGIME_LABEL: Record<'REEL_NORMAL' | 'REEL_SIMPLIFIE', string> = {
  REEL_NORMAL: 'Régime réel normal',
  REEL_SIMPLIFIE: 'Régime réel simplifié',
};

const JURISDICTION_LABEL: Record<'FR' | 'MC', string> = {
  FR: 'France',
  MC: 'Monaco',
};

const LANDING_ROUTE_OPTIONS = [HOME_ITEM, ...NAV_GROUPS.flatMap((g) => g.items), ASSISTANT_ITEM];

/**
 * Paramètres — app-level preferences (Apparence, Général) plus the
 * reachable hub for the app's scattered configuration screens. Every
 * control on this page is either a client-only display preference
 * (theme, density, default landing screen — persisted to localStorage,
 * never sent to the API) or pure navigation to an existing screen.
 * Nothing here computes or writes ledger data.
 */
export function SettingsPage() {
  const companyQuery = useCompany();
  const cloudCredentialsQuery = useCloudCredentials();
  const { theme, setTheme, density, setDensity, defaultLandingRoute, setDefaultLandingRoute } =
    usePreferences();

  const company = companyQuery.data;
  const credentials = cloudCredentialsQuery.data ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-9 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Paramètres</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Apparence, préférences générales, et configuration de la société.
        </p>
      </header>

      <SettingsSection title="Apparence" description="S'applique instantanément, sur tout l'écran.">
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-card">
          <PreferenceRow label="Thème" description="Suit le système par défaut.">
            <SegmentedControl<ThemePreference>
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: 'Clair', Icon: IconSun },
                { value: 'system', label: 'Système', Icon: IconMonitor },
                { value: 'dark', label: 'Sombre', Icon: IconMoon },
              ]}
            />
          </PreferenceRow>
          <div className="h-px bg-border" />
          <PreferenceRow label="Densité" description="Resserre les lignes des tableaux.">
            <SegmentedControl<DensityPreference>
              value={density}
              onChange={setDensity}
              options={[
                { value: 'comfortable', label: 'Confortable' },
                { value: 'compact', label: 'Compacte' },
              ]}
            />
          </PreferenceRow>
        </div>
      </SettingsSection>

      <SettingsSection title="Général">
        <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
          <PreferenceRow
            label="Écran de démarrage"
            description="Ce que « compta » affiche à l'ouverture."
          >
            <select
              value={defaultLandingRoute}
              onChange={(e) => setDefaultLandingRoute(e.target.value)}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            >
              {LANDING_ROUTE_OPTIONS.map((item) => (
                <option key={item.to} value={item.to}>
                  {item.label}
                </option>
              ))}
            </select>
          </PreferenceRow>
        </div>
        <p className="text-[12px] text-ink-faint">
          Le format des dates et des montants suit la convention française (jour/mois/année,
          virgule décimale) partout dans l'application — c'est le format de la liasse et du FEC
          eux-mêmes, pas une préférence d'affichage à faire varier.
        </p>
      </SettingsSection>

      <SettingsSection title="Configuration du dossier">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SettingsCard
            to="/societe"
            Icon={IconBuilding}
            title="Société"
            description={
              company
                ? `${JURISDICTION_LABEL[company.jurisdiction]} · ${REGIME_LABEL[company.regime]}`
                : 'Identité, régime fiscal, adresse'
            }
          />
          <SettingsCard
            to="/comptes"
            Icon={IconList}
            title="Comptes & journaux"
            description="Journaux comptables et plan comptable (PCG)"
          />
          <SettingsCard
            to="/tva"
            Icon={IconPercent}
            title="TVA — Taux"
            description="Taux de TVA applicables et leur période de validité"
          />
          <SettingsCard
            to="/assistant/parametres"
            Icon={IconChat}
            title="Assistant IA"
            description={
              credentials.length > 0
                ? `${credentials.length} fournisseur${credentials.length > 1 ? 's' : ''} cloud configuré${credentials.length > 1 ? 's' : ''}`
                : 'Modèle local, propositions cloud (Claude, DeepSeek)'
            }
          />
          <SettingsCard
            to="/parametres/nouvelle-societe"
            Icon={IconPlus}
            title="Nouvelle société"
            description="Créer un nouveau dossier — plan comptable et journaux pré-configurés"
          />
        </div>
      </SettingsSection>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[12.5px] text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function PreferenceRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-[13.5px] font-medium text-ink">{label}</div>
        {description && <div className="text-[12px] text-ink-faint">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; Icon?: (props: { width?: number; height?: number }) => ReactNode }[];
}) {
  return (
    <div
      role="radiogroup"
      className="flex items-center gap-0.5 rounded-md border border-border bg-bg p-0.5"
    >
      {options.map(({ value: optionValue, label, Icon }) => {
        const isActive = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(optionValue)}
            className={[
              'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              isActive ? 'bg-surface text-accent shadow-card' : 'text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            {Icon && <Icon width={13} height={13} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SettingsCard({
  to,
  Icon,
  title,
  description,
}: {
  to: string;
  Icon: (props: { className?: string }) => ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3.5 rounded-lg border border-border bg-surface p-5 shadow-card transition-colors hover:border-accent-soft hover:bg-accent-soft/40"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
        <Icon className="shrink-0" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-ink">{title}</span>
        <span className="text-[12.5px] text-ink-muted">{description}</span>
      </div>
    </Link>
  );
}
