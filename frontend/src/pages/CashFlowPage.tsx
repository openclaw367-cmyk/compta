import { useMemo, useState } from 'react';
import {
  useDownloadCashFlowExcel,
  useDownloadCashFlowPdf,
  useEcritures,
  useGenerateCashFlow,
} from '../api/queries';
import type { CashFlowStatement, FluxExploitation, FluxFinancement, FluxInvestissement } from '../api/types';
import { ApiError } from '../api/client';
import { useAppContext } from '../context/appContextStore';
import { formatMoneyFr, isZeroMoney, subtractMoneyStrings } from '../lib/money';

const NO_ECRITURES: never[] = [];

export function CashFlowPage() {
  const { fiscalYears, fiscalYearId, fiscalYearsLoading } = useAppContext();
  const ecrituresQuery = useEcritures();
  const generateCashFlow = useGenerateCashFlow();
  const downloadPdf = useDownloadCashFlowPdf();
  const downloadExcel = useDownloadCashFlowExcel();

  const ecritures = ecrituresQuery.data ?? NO_ECRITURES;

  const [error, setError] = useState<string[] | null>(null);
  // The currently-generated statement is only shown while it still matches
  // the app-wide fiscal-year selection — switching the topbar selector
  // must never leave a PREVIOUS year's figures on screen implying they're
  // current. See handleGenerate().
  const [generatedForFiscalYearId, setGeneratedForFiscalYearId] = useState<string | null>(null);

  const draftsInYear = useMemo(
    () => ecritures.filter((e) => e.fiscalYearId === fiscalYearId && e.validatedAt === null),
    [ecritures, fiscalYearId],
  );

  const canGenerate =
    Boolean(fiscalYearId) && draftsInYear.length === 0 && !generateCashFlow.isPending;

  async function handleGenerate() {
    if (!fiscalYearId) return;
    setError(null);
    try {
      await generateCashFlow.mutateAsync({ fiscalYearId });
      setGeneratedForFiscalYearId(fiscalYearId);
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['Le calcul a échoué.']);
    }
  }

  const isLoading = fiscalYearsLoading || ecrituresQuery.isLoading;
  const statement =
    generatedForFiscalYearId === fiscalYearId ? (generateCashFlow.data ?? null) : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">
          Flux de trésorerie
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Tableau des flux de trésorerie, méthode indirecte — calcule et affiche, n'écrit jamais
          dans le journal.
        </p>
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Chargement…
        </div>
      ) : fiscalYears.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Aucun exercice — créez-en un dans « Exercices » pour calculer un tableau de flux.
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-[13px] text-ink-muted">
              Exercice sélectionné :{' '}
              <span className="font-medium text-ink">
                {fiscalYears.find((fy) => fy.id === fiscalYearId)?.label ?? '—'}
              </span>{' '}
              <span className="text-ink-faint">(changez-le en haut de l'écran)</span>
            </p>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                disabled={!fiscalYearId || downloadPdf.isPending}
                onClick={() => fiscalYearId && void downloadPdf.mutate({ fiscalYearId })}
                className="rounded-md border border-border px-3 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:text-ink-faint"
              >
                {downloadPdf.isPending ? 'Génération…' : 'Télécharger PDF'}
              </button>
              <button
                type="button"
                disabled={!fiscalYearId || downloadExcel.isPending}
                onClick={() => fiscalYearId && void downloadExcel.mutate({ fiscalYearId })}
                className="rounded-md border border-border px-3 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:text-ink-faint"
              >
                {downloadExcel.isPending ? 'Génération…' : 'Télécharger Excel'}
              </button>
              <button
                type="button"
                disabled={!canGenerate}
                onClick={() => void handleGenerate()}
                className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
              >
                {generateCashFlow.isPending ? 'Calcul…' : 'Générer'}
              </button>
            </div>
          </div>

          {draftsInYear.length > 0 && (
            <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
              {draftsInYear.length === 1
                ? "1 écriture en brouillon bloque le calcul : une écriture non validée dans " +
                  "l'exercice empêche tout le tableau, il ne saute jamais silencieusement les " +
                  'brouillons. Validez-la ou supprimez-la pour continuer.'
                : `${draftsInYear.length} écritures en brouillon bloquent le calcul : une ` +
                  "écriture non validée dans l'exercice empêche tout le tableau, il ne saute " +
                  'jamais silencieusement les brouillons. Validez-les ou supprimez-les pour ' +
                  'continuer.'}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
              {error.map((message, i) => (
                <div key={i}>{message}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {statement && (
        <>
          <ReconciliationBanner statement={statement} />
          <FluxExploitationSection flux={statement.fluxExploitation} />
          <FluxInvestissementSection flux={statement.fluxInvestissement} />
          <FluxFinancementSection flux={statement.fluxFinancement} />
        </>
      )}
    </div>
  );
}

/**
 * THE reconciliation invariant, shown the same way BalanceBanner shows
 * Actif=Passif on LiassePage: since the backend already refuses (409)
 * a mismatch, a statement reaching this component is already reconciled
 * — this banner displays that fact rather than re-deriving it, using
 * string-only Money arithmetic (subtractMoneyStrings/isZeroMoney), never
 * a JS number, matching the rest of this app's money-handling rule.
 */
function ReconciliationBanner({ statement }: { statement: CashFlowStatement }) {
  const actualDelta = subtractMoneyStrings(statement.tresorerieCloture, statement.tresorerieOuverture);
  const reconciles = isZeroMoney(subtractMoneyStrings(statement.variationTresorerie, actualDelta));

  return (
    <div
      className={[
        'flex items-center justify-between rounded-lg border p-5',
        reconciles ? 'border-positive-soft bg-positive-soft' : 'border-negative-soft bg-negative-soft',
      ].join(' ')}
    >
      <div>
        <div
          className={[
            'text-[11px] font-semibold uppercase tracking-wide',
            reconciles ? 'text-positive' : 'text-negative',
          ].join(' ')}
        >
          {reconciles ? 'Tableau réconcilié' : 'Tableau non réconcilié'}
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Trésorerie {formatMoneyFr(statement.tresorerieOuverture)} →{' '}
          {formatMoneyFr(statement.tresorerieCloture)}
        </p>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] tabular-nums text-ink-muted">Somme des 3 flux</span>
        <span
          className={[
            'text-[22px] font-semibold tabular-nums',
            reconciles ? 'text-positive' : 'text-negative',
          ].join(' ')}
        >
          {formatMoneyFr(statement.variationTresorerie)}
        </span>
      </div>
    </div>
  );
}

function Row({ label, code, value, muted }: { label: string; code?: string; value: string; muted?: boolean }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className={['px-4 py-2.5', muted ? 'text-ink-muted' : 'text-ink'].join(' ')}>
        {code && <span className="mr-2 font-medium tabular-nums text-ink-faint">{code}</span>}
        {label}
      </td>
      <td className={['px-4 py-2.5 text-right tabular-nums', muted ? 'text-ink-muted' : 'text-ink'].join(' ')}>
        {formatMoneyFr(value)}
      </td>
    </tr>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="bg-bg">
      <td className="px-4 py-2.5 font-semibold text-ink">{label}</td>
      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
        {formatMoneyFr(value)}
      </td>
    </tr>
  );
}

function FluxExploitationSection({ flux }: { flux: FluxExploitation }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">Flux d'exploitation</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Résultat net, retraité des éléments non monétaires (CAF), puis ajusté de la variation du
          besoin en fonds de roulement.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Capacité d'autofinancement (CAF)</th>
              <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Résultat net" value={flux.resultatNet} />
            <Row
              label="+ Dotations amortissements et provisions"
              value={flux.dotationsAmortissementsProvisions}
            />
            <Row
              label="+ Valeur comptable des éléments d'actif cédés"
              value={flux.valeurComptableElementsCedes}
            />
            <Row
              label="− Reprises sur amortissements et provisions"
              value={flux.reprisesAmortissementsProvisions}
              muted
            />
            <Row label="− Produits des cessions d'éléments d'actif" value={flux.produitsDesCessions} muted />
            <TotalRow label="= Capacité d'autofinancement (CAF)" value={flux.capaciteAutofinancement} />
            <Row
              label="− Variation des créances clients (brut)"
              value={flux.variationCreancesClients}
              muted
            />
            <Row label="− Variation des stocks (brut)" value={flux.variationStocks} muted />
            <Row
              label="− Variation TVA déductible (autres biens et services, 445660)"
              value={flux.variationTvaDeductibleAutres}
              muted
            />
            <Row
              label="+ Variation des dettes d'exploitation"
              value={flux.variationDettesExploitation}
            />
            <TotalRow label="= Flux net de trésorerie d'exploitation" value={flux.total} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FluxInvestissementSection({ flux }: { flux: FluxInvestissement }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">Flux d'investissement</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Acquisitions et cessions d'immobilisations, nettes des créances/dettes qui décalent
          l'encaissement ou le décaissement réel.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Investissement</th>
              <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="− Acquisitions d'immobilisations"
              value={flux.acquisitionsImmobilisations}
              muted
            />
            <Row
              label="− Variation TVA déductible (immobilisations, 445662)"
              value={flux.variationTvaDeductibleImmobilisations}
              muted
            />
            <Row
              label="+ Variation des dettes sur immobilisations"
              value={flux.variationDettesSurImmobilisations}
            />
            <Row label="+ Cessions d'immobilisations" value={flux.cessionsImmobilisations} />
            <Row
              label="− Variation des créances sur cessions"
              value={flux.variationCreancesSurCessions}
              muted
            />
            <TotalRow label="= Flux net de trésorerie d'investissement" value={flux.total} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FluxFinancementSection({ flux }: { flux: FluxFinancement }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">Flux de financement</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Variation des emprunts, du capital et des comptes courants d'associés (compte 455 —
          positif quand un associé avance de la trésorerie à la société). Les distributions
          restent à 0,00 — aucun mécanisme d'affectation du résultat n'existe encore dans
          l'application.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Financement</th>
              <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
            </tr>
          </thead>
          <tbody>
            <Row label="+ Variation des emprunts" value={flux.variationEmprunts} />
            <Row label="+ Variation du capital" value={flux.variationCapital} />
            <Row
              label="+ Variation des comptes courants d'associés"
              value={flux.variationComptesCourantsAssocies}
            />
            <Row label="− Distributions" value={flux.distributions} muted />
            <TotalRow label="= Flux net de trésorerie de financement" value={flux.total} />
          </tbody>
        </table>
      </div>
    </section>
  );
}
