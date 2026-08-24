import { useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useJournals, useTrialBalance } from '../api/queries';
import { TrialBalanceTable } from '../components/ledger/TrialBalanceTable';
import { useAppContext } from '../context/appContextStore';

const NO_JOURNALS: never[] = [];

export function GrandLivrePage() {
  const { fiscalYears, fiscalYearId, fiscalYearsLoading } = useAppContext();
  const journalsQuery = useJournals();
  const journals = journalsQuery.data ?? NO_JOURNALS;
  const [searchParams] = useSearchParams();
  const deepLinkedAccountId = searchParams.get('compte');

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  const trialBalanceQuery = useTrialBalance({
    fiscalYearId,
    periodStart: periodStart || undefined,
    periodEnd: periodEnd || undefined,
  });

  const isLoading = fiscalYearsLoading || journalsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  const hasPeriodFilter = periodStart !== '' || periodEnd !== '';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Grand livre</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Balance générale par compte — cliquez une ligne pour le détail des écritures.
          </p>
        </div>
        <div className="ml-auto flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Exercice
            </span>
            <span className="py-[7px] text-[13px] text-ink">
              {fiscalYears.find((fy) => fy.id === fiscalYearId)?.label ?? '—'}
            </span>
          </div>
          <Field label="Du">
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="rounded-md border border-border bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus:border-accent"
            />
          </Field>
          <Field label="Au">
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="rounded-md border border-border bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus:border-accent"
            />
          </Field>
          {hasPeriodFilter && (
            <button
              type="button"
              onClick={() => {
                setPeriodStart('');
                setPeriodEnd('');
              }}
              className="rounded-md px-2.5 py-2 text-[12.5px] font-medium text-ink-muted hover:bg-bg"
            >
              Réinitialiser
            </button>
          )}
        </div>
      </header>

      {trialBalanceQuery.isLoading || !fiscalYearId ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-ink-faint">
          Chargement…
        </div>
      ) : trialBalanceQuery.isError ? (
        <div className="rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
          Impossible de charger la balance générale.
        </div>
      ) : trialBalanceQuery.data ? (
        <TrialBalanceTable
          data={trialBalanceQuery.data}
          fiscalYearId={fiscalYearId}
          periodStart={periodStart || undefined}
          periodEnd={periodEnd || undefined}
          journals={journals}
          initialExpandedAccountId={deepLinkedAccountId}
        />
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
