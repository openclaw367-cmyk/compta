import { useAnomaliesSummary } from '../api/queries';
import { useAppContext } from '../context/appContextStore';
import { ApiError } from '../api/client';
import { PaymentAnomalyRow, SpendingAnomalyRow } from '../components/anomalies/AnomalyRows';

/**
 * Anomaly surfacing — see CLAUDE.md "Anomaly surfacing". Gentle,
 * non-blocking flags computed fresh on every load, never persisted,
 * never gating anything. Full lists for the selected fiscal year — the
 * dashboard's own tile shows only the top few.
 */
export function AnomaliesPage() {
  const { fiscalYearId, fiscalYearsLoading } = useAppContext();
  const summaryQuery = useAnomaliesSummary(fiscalYearId);

  const isLoading = fiscalYearsLoading || summaryQuery.isLoading;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Anomalies</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Signaux à surveiller — jamais bloquants, jamais appliqués automatiquement. Cliquez une
          ligne pour l&rsquo;examiner.
        </p>
      </header>

      {isLoading ? (
        <div className="h-64 w-full animate-pulse rounded-lg bg-border" />
      ) : summaryQuery.isError ? (
        <div className="rounded-md bg-negative-soft px-4 py-3 text-[13px] text-negative">
          {summaryQuery.error instanceof ApiError
            ? summaryQuery.error.message
            : 'Impossible de charger les anomalies.'}
        </div>
      ) : summaryQuery.data ? (
        <>
          <Section
            title="Écarts de dépenses"
            description="Comptes de charges/produits dont le total mensuel dépasse nettement leur propre moyenne récente."
            empty="Aucun écart détecté pour cet exercice."
          >
            {summaryQuery.data.spending.map((anomaly) => (
              <SpendingAnomalyRow
                key={`${anomaly.accountId}-${anomaly.month}`}
                anomaly={anomaly}
              />
            ))}
          </Section>

          <Section
            title="Factures en attente de règlement"
            description="Factures de vente finalisées, non lettrées, émises depuis plus de 30 jours."
            empty="Aucune facture en attente de règlement."
          >
            {summaryQuery.data.payments.map((anomaly) => (
              <PaymentAnomalyRow key={anomaly.invoiceId} anomaly={anomaly} />
            ))}
          </Section>
        </>
      ) : null}
    </div>
  );
}

function Section({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">{description}</p>
      {hasChildren ? (
        <div className="mt-3 flex flex-col gap-2">{children}</div>
      ) : (
        <p className="mt-4 text-[12.5px] text-ink-faint">{empty}</p>
      )}
    </div>
  );
}
