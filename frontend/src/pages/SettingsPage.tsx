import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCompany, useCloudCredentials } from '../api/queries';
import {
  IconBuilding,
  IconChat,
  IconList,
  IconPercent,
} from '../components/layout/icons';

const REGIME_LABEL: Record<'REEL_NORMAL' | 'REEL_SIMPLIFIE', string> = {
  REEL_NORMAL: 'Régime réel normal',
  REEL_SIMPLIFIE: 'Régime réel simplifié',
};

const JURISDICTION_LABEL: Record<'FR' | 'MC', string> = {
  FR: 'France',
  MC: 'Monaco',
};

/**
 * A single, reachable hub for the app's scattered configuration screens —
 * pure navigation, nothing here computes or writes. Each card links to an
 * existing, already-working screen (Société, Comptes & journaux, TVA
 * rates, Assistant IA) rather than duplicating any of their logic.
 */
export function SettingsPage() {
  const companyQuery = useCompany();
  const cloudCredentialsQuery = useCloudCredentials();

  const company = companyQuery.data;
  const credentials = cloudCredentialsQuery.data ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Paramètres</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Configuration de la société, du plan comptable et de l'assistant IA.
        </p>
      </header>

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
      </div>
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
      className="flex items-start gap-3.5 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent-soft hover:bg-accent-soft/40"
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
