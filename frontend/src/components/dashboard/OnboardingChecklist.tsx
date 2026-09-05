import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBankAccounts, useMemberships, useVatRates } from '../../api/queries';
import { useAppContext } from '../../context/appContextStore';
import { IconX } from '../layout/icons';

const DISMISSED_KEY_PREFIX = 'compta:onboarding-dismissed:';

interface ChecklistStep {
  id: string;
  label: string;
  description: string;
  to: string;
  done: boolean;
}

/**
 * A dismissible "getting started" checklist for a freshly-created company —
 * every "done" signal is derived from data this app already fetches
 * elsewhere (fiscal years from useAppContext(), the same array TopBar's own
 * exercice selector reads; VAT rates/memberships/bank accounts from their
 * own already-shipped screens), never a new backend field or business
 * rule. Dismissal is a per-viewer, per-company convenience persisted to
 * localStorage — same "not the place for anything that must persist
 * reliably or be shared between viewers" discipline as the theme/density
 * preferences in PreferencesProvider.tsx, just scoped by company since a
 * bookkeeper working across several dossiers may be mid-setup on one and
 * fully onboarded on another.
 */
export function OnboardingChecklist() {
  const { companyId, fiscalYears } = useAppContext();
  const vatRatesQuery = useVatRates();
  const membershipsQuery = useMemberships();
  const bankAccountsQuery = useBankAccounts();
  const [dismissedTick, setDismissedTick] = useState(0);

  if (!companyId) return null;
  const dismissed = localStorage.getItem(DISMISSED_KEY_PREFIX + companyId) === '1';
  if (dismissed) return null;

  // Wait for every signal — a step showing "done" before its own query has
  // even resolved would be a false, briefly-flashing negative, not an
  // honest "not yet known".
  if (vatRatesQuery.isLoading || membershipsQuery.isLoading || bankAccountsQuery.isLoading) {
    return <div className="h-24 w-full animate-pulse rounded-lg bg-border" />;
  }
  if (vatRatesQuery.isError || membershipsQuery.isError || bankAccountsQuery.isError) {
    return null;
  }

  const steps: ChecklistStep[] = [
    {
      id: 'fiscal-year',
      label: 'Créer votre premier exercice',
      description: 'Le point de départ de toute comptabilité — chaque écriture appartient à un exercice.',
      to: '/exercices',
      done: fiscalYears.length > 0,
    },
    {
      id: 'vat-rate',
      label: 'Configurer vos taux de TVA',
      description: 'Nécessaire pour taguer vos écritures de vente/achat et générer une déclaration.',
      to: '/tva?section=taux',
      done: (vatRatesQuery.data?.length ?? 0) > 0,
    },
    {
      id: 'team',
      label: 'Inviter votre équipe',
      description: 'Comptable, associé ou collaborateur — chacun avec son propre accès et son rôle.',
      to: '/parametres/membres',
      done: (membershipsQuery.data?.members.length ?? 0) > 1,
    },
    {
      id: 'bank-account',
      label: 'Connecter un compte bancaire',
      description: 'Importez un relevé pour rapprocher vos écritures automatiquement.',
      to: '/rapprochement-bancaire',
      done: (bankAccountsQuery.data?.length ?? 0) > 0,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY_PREFIX + companyId!, '1');
    setDismissedTick((t) => t + 1);
  }

  return (
    <div key={dismissedTick} className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Bien démarrer</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {doneCount} sur {steps.length} étapes terminées.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          title="Masquer cette liste"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-bg hover:text-ink-muted"
        >
          <IconX width={13} height={13} />
          <span className="sr-only">Masquer</span>
        </button>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {steps.map((step) => (
          <Link
            key={step.id}
            to={step.to}
            className={[
              'flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
              step.done
                ? 'border-border bg-bg/40 text-ink-faint'
                : 'border-border hover:border-accent-soft hover:bg-accent-soft/30',
            ].join(' ')}
          >
            <span
              className={[
                'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                step.done
                  ? 'border-positive bg-positive text-white'
                  : 'border-border-strong text-transparent',
              ].join(' ')}
            >
              ✓
            </span>
            <span>
              <span
                className={[
                  'block text-[13px] font-medium',
                  step.done ? 'text-ink-faint line-through' : 'text-ink',
                ].join(' ')}
              >
                {step.label}
              </span>
              <span className="mt-0.5 block text-[11.5px] text-ink-muted">{step.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
