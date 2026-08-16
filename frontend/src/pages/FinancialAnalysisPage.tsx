import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useEcritures, useFiscalYears, useGenerateFinancialAnalysis } from '../api/queries';
import type {
  BfrSnapshot,
  CoutDeLaDette,
  EndettementEtCapitaux,
  FondsDeRoulement,
  FreeCashFlow,
  Margins,
  Ratios,
  SigCascade,
  TresorerieNette,
} from '../api/types';
import { ApiError } from '../api/client';
import { addMoneyStrings, formatMoneyFr, isZeroMoney, subtractMoneyStrings } from '../lib/money';

const NO_FISCAL_YEARS: never[] = [];
const NO_ECRITURES: never[] = [];

/** Percentage strings from the backend are plain decimals ("40.00" = 40.00%), not money — comma-localized here, never re-computed. */
function formatPercent(value: string | null): string {
  if (value === null) return 'n/a';
  const negative = value.startsWith('-');
  return `${negative ? '−' : ''}${value.replace('-', '').replace('.', ',')} %`;
}

/** Dimensionless ratio (e.g. liquidité générale) — same comma-localization, no % suffix. */
function formatRatio(value: string | null): string {
  if (value === null) return 'n/a';
  const negative = value.startsWith('-');
  return `${negative ? '−' : ''}${value.replace('-', '').replace('.', ',')}`;
}

/** Day count (DSO/DPO/rotation stocks). */
function formatDays(value: string | null): string {
  if (value === null) return 'n/a';
  return `${value.replace('.', ',')} j`;
}

function isNegativeMoney(value: string): boolean {
  return value.trim().startsWith('-') && !isZeroMoney(value);
}

export function FinancialAnalysisPage() {
  const fiscalYearsQuery = useFiscalYears();
  const ecrituresQuery = useEcritures();
  const generateAnalysis = useGenerateFinancialAnalysis();

  const fiscalYears = fiscalYearsQuery.data ?? NO_FISCAL_YEARS;
  const ecritures = ecrituresQuery.data ?? NO_ECRITURES;

  const [fiscalYearId, setFiscalYearId] = useState<string | null>(null);
  const [error, setError] = useState<string[] | null>(null);

  useEffect(() => {
    if (!fiscalYearId && fiscalYears.length > 0) setFiscalYearId(fiscalYears[0].id);
  }, [fiscalYearId, fiscalYears]);

  const draftsInYear = useMemo(
    () => ecritures.filter((e) => e.fiscalYearId === fiscalYearId && e.validatedAt === null),
    [ecritures, fiscalYearId],
  );

  const canGenerate =
    Boolean(fiscalYearId) && draftsInYear.length === 0 && !generateAnalysis.isPending;

  async function handleGenerate() {
    if (!fiscalYearId) return;
    setError(null);
    try {
      await generateAnalysis.mutateAsync({ fiscalYearId });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['Le calcul a échoué.']);
    }
  }

  const isLoading = fiscalYearsQuery.isLoading || ecrituresQuery.isLoading;
  const result = generateAnalysis.data ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Analyse financière</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Retraitement analytique — entièrement déterministe, chaque chiffre se retrace à des
          comptes précis. Aucune hypothèse (WACC, DCF, multiples) : ceci alimente un futur module «
          Valorisation », il ne le remplace pas.
        </p>
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Chargement…
        </div>
      ) : fiscalYears.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Aucun exercice — créez-en un dans « Exercices » pour calculer une analyse.
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Exercice">
              <select
                value={fiscalYearId ?? ''}
                onChange={(e) => {
                  setFiscalYearId(e.target.value);
                  setError(null);
                }}
                className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
              >
                {fiscalYears.map((fy) => (
                  <option key={fy.id} value={fy.id}>
                    {fy.label}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => void handleGenerate()}
              className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {generateAnalysis.isPending ? 'Calcul…' : 'Générer'}
            </button>
          </div>

          {draftsInYear.length > 0 && (
            <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
              {draftsInYear.length === 1
                ? "1 écriture en brouillon bloque le calcul : une écriture non validée dans " +
                  "l'exercice empêche toute l'analyse, elle ne saute jamais silencieusement les " +
                  'brouillons. Validez-la ou supprimez-la pour continuer.'
                : `${draftsInYear.length} écritures en brouillon bloquent le calcul : une ` +
                  "écriture non validée dans l'exercice empêche toute l'analyse, elle ne saute " +
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

      {result && (
        <>
          <SigSection sig={result.sig} />
          <MarginsSection margins={result.margins} />
          <BfrSection bfr={result.bfr} fr={result.fondsDeRoulement} />
          <TresorerieSection tresorerie={result.tresorerieNette} />
          <FreeCashFlowSection fcf={result.freeCashFlow} />
          <EndettementSection endettement={result.endettementEtCapitaux} />
          <CoutDeLaDetteSection cout={result.coutDeLaDette} dettesFinancieres={result.endettementEtCapitaux.dettesFinancieres} />
          <RatiosSection ratios={result.ratios} endettement={result.endettementEtCapitaux} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared row primitives
// ---------------------------------------------------------------------------

function Row({
  label,
  caption,
  value,
  muted,
}: {
  label: string;
  caption?: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2.5">
        <div className={muted ? 'text-ink-muted' : 'text-ink'}>{label}</div>
        {caption && <div className="mt-0.5 text-[11px] text-ink-faint">{caption}</div>}
      </td>
      <td className={['px-4 py-2.5 text-right tabular-nums', muted ? 'text-ink-muted' : 'text-ink'].join(' ')}>
        {value}
      </td>
    </tr>
  );
}

function TotalRow({ label, caption, value }: { label: string; caption?: string; value: string }) {
  return (
    <tr className="bg-bg">
      <td className="px-4 py-2.5">
        <div className="font-semibold text-ink">{label}</div>
        {caption && <div className="mt-0.5 text-[11px] font-normal text-ink-faint">{caption}</div>}
      </td>
      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{value}</td>
    </tr>
  );
}

function Table({ header, children }: { header: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5 font-semibold">{header}</th>
            <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SIG — soldes intermédiaires de gestion, rendered as a visible cascade:
// each solde's caption names the exact compte-de-résultat line codes it
// sums, and the next row's label makes clear it builds on the row above —
// this IS the "economic reality vs. compliance" translation the module
// exists for, so it has to read as a chain, not a flat list of numbers.
// ---------------------------------------------------------------------------

function SigSection({ sig }: { sig: SigCascade }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Soldes intermédiaires de gestion (SIG)"
        description="Cascade complète — chaque solde se déduit du précédent, en partant des comptes du compte de résultat."
      />
      <Table header="Cascade">
        <Row
          label="Marge commerciale"
          caption="Ventes de marchandises (FC) − Achats de marchandises (FS) − Variation de stocks (FT)"
          value={formatMoneyFr(sig.margeCommerciale)}
        />
        <Row
          label="+ Production de l'exercice"
          caption="Production vendue biens (FF) + services (FI) + stockée (FM) + immobilisée (FN)"
          value={formatMoneyFr(sig.productionDeLExercice)}
        />
        <Row
          label="− Consommations en provenance des tiers"
          caption="Achats de matières premières (FU) + leur variation de stock (FV) + autres achats et charges externes (FW)"
          value={formatMoneyFr(sig.consommationsEnProvenanceDesTiers)}
          muted
        />
        <TotalRow label="= Valeur ajoutée" value={formatMoneyFr(sig.valeurAjoutee)} />
        <Row
          label="→ Excédent brut d'exploitation (EBE, ≈ EBITDA)"
          caption="Valeur ajoutée + subventions d'exploitation (FO) − impôts et taxes (FX) − salaires (FY) − cotisations sociales (FZ)"
          value={formatMoneyFr(sig.ebe)}
        />
        <Row
          label="→ Résultat d'exploitation (EBIT)"
          caption="EBE + reprises (FP) + produits de cession (F1) + autres produits (FQ) − dotations (GA-GD) − VNC cédée (G1) − autres charges (GE)"
          value={formatMoneyFr(sig.resultatExploitation)}
        />
        <Row
          label="+ Résultat financier"
          caption="Produits financiers − charges financières (intérêts, GR)"
          value={formatMoneyFr(sig.resultatFinancier)}
          muted={sig.resultatFinancier.startsWith('-')}
        />
        <TotalRow label="= Résultat courant avant impôts" value={formatMoneyFr(sig.resultatCourantAvantImpots)} />
        <Row
          label="+ Résultat exceptionnel"
          caption="Produits exceptionnels (HD) − charges exceptionnelles (HH)"
          value={formatMoneyFr(sig.resultatExceptionnel)}
        />
        <Row
          label="− Participation salariés et impôts sur les bénéfices"
          caption="Participation des salariés (HJ) + Impôts sur les bénéfices (HK) — dérivé : résultat courant + résultat exceptionnel − résultat net"
          value={formatMoneyFr(
            subtractMoneyStrings(
              addMoneyStrings(sig.resultatCourantAvantImpots, sig.resultatExceptionnel),
              sig.resultatNet,
            ),
          )}
          muted
        />
        <TotalRow label="= Résultat net" value={formatMoneyFr(sig.resultatNet)} />
      </Table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Margins
// ---------------------------------------------------------------------------

function MarginsSection({ margins }: { margins: Margins }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Marges"
        description="Chaque marge est exprimée en % du même chiffre d'affaires (FC+FF+FI), pour rester directement comparables entre elles."
      />
      <Table header="Marge">
        <Row label="Chiffre d'affaires (FC+FF+FI)" value={formatMoneyFr(margins.chiffreDAffaires)} />
        <Row
          label="Marge brute"
          caption="Marge commerciale ÷ chiffre d'affaires"
          value={formatPercent(margins.margeBrute)}
        />
        <Row
          label="Marge d'EBE"
          caption="EBE ÷ chiffre d'affaires"
          value={formatPercent(margins.margeEbe)}
        />
        <Row
          label="Marge d'exploitation"
          caption="Résultat d'exploitation ÷ chiffre d'affaires"
          value={formatPercent(margins.margeExploitation)}
        />
        <Row
          label="Marge nette"
          caption="Résultat net ÷ chiffre d'affaires"
          value={formatPercent(margins.margeNette)}
        />
      </Table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// BFR / FR — a reconciliation banner shows the identity holding (the
// backend already asserts it before returning 200, so a result reaching
// here is already reconciled — this displays that fact).
// ---------------------------------------------------------------------------

function BfrSection({ bfr, fr }: { bfr: BfrSnapshot; fr: FondsDeRoulement }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="BFR et fonds de roulement"
        description="BFR en valeurs brutes (même convention que le tableau de flux de trésorerie, pour que les deux modules s'accordent au centime près)."
      />
      <Table header="Besoin en fonds de roulement (BFR)">
        <Row
          label="BFR d'exploitation"
          caption="Clients bruts (BX) + Stocks bruts + TVA déductible autres biens (445660) − Dettes fournisseurs (DX) − Dettes fiscales et sociales (DY)"
          value={formatMoneyFr(bfr.bfrExploitation)}
        />
        <Row
          label="BFR hors exploitation"
          caption="Créances sur cessions (462) + TVA déductible immobilisations (445662) − Dettes sur immobilisations (DZ) − Autres dettes (EA)"
          value={formatMoneyFr(bfr.bfrHorsExploitation)}
        />
        <TotalRow label="= BFR total" value={formatMoneyFr(bfr.bfrTotal)} />
      </Table>
      <Table header="Fonds de roulement (FR)">
        <Row
          label="Ressources stables"
          caption="Capitaux propres (DA-DK+DI) + Provisions pour risques et charges (DP+DQ) + Dettes financières (DS+DT+DU+DV)"
          value={formatMoneyFr(fr.ressourcesStables)}
        />
        <Row
          label="− Emplois stables"
          caption="Immobilisations nettes"
          value={formatMoneyFr(fr.emploisStables)}
          muted
        />
        <TotalRow label="= Fonds de roulement" value={formatMoneyFr(fr.fondsDeRoulement)} />
      </Table>
    </section>
  );
}

function TresorerieSection({ tresorerie }: { tresorerie: TresorerieNette }) {
  const reconciles = isZeroMoney(subtractMoneyStrings(tresorerie.parFrMoinsBfr, tresorerie.disponibilites));

  return (
    <section className="flex flex-col gap-4">
      <div
        className={[
          'flex flex-col gap-3 rounded-lg border p-5',
          reconciles ? 'border-positive-soft bg-positive-soft' : 'border-negative-soft bg-negative-soft',
        ].join(' ')}
      >
        <div className="flex items-center justify-between">
          <div>
            <div
              className={[
                'text-[11px] font-semibold uppercase tracking-wide',
                reconciles ? 'text-positive' : 'text-negative',
              ].join(' ')}
            >
              {reconciles ? 'Trésorerie nette réconciliée' : 'Trésorerie nette non réconciliée'}
            </div>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              FR − BFR + provisions sur actif circulant = disponibilités
            </p>
          </div>
          <div
            className={[
              'text-[22px] font-semibold tabular-nums',
              reconciles ? 'text-positive' : 'text-negative',
            ].join(' ')}
          >
            {formatMoneyFr(tresorerie.parFrMoinsBfr)}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-[12px]">
          <div>
            <div className="text-ink-faint">FR − BFR</div>
            <div className="tabular-nums text-ink-muted">
              {formatMoneyFr(subtractMoneyStrings(tresorerie.parFrMoinsBfr, tresorerie.provisionsSurActifCirculant))}
            </div>
          </div>
          <div>
            <div className="text-ink-faint">
              + Provisions sur actif circulant
              <span className="ml-1 text-ink-faint">(BX/491 + stocks/39x)</span>
            </div>
            <div className="tabular-nums text-ink-muted">
              {formatMoneyFr(tresorerie.provisionsSurActifCirculant)}
            </div>
          </div>
          <div>
            <div className="text-ink-faint">Disponibilités (bilan)</div>
            <div className="tabular-nums text-ink-muted">{formatMoneyFr(tresorerie.disponibilites)}</div>
          </div>
        </div>
        {!isZeroMoney(tresorerie.provisionsSurActifCirculant) && (
          <p className="text-[11.5px] text-ink-faint">
            Le BFR est calculé en valeurs brutes (comme le tableau de flux) alors que le fonds de
            roulement est net — ce troisième terme corrige cet écart de base, il ne comble pas un
            résidu.
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Free cash flow
// ---------------------------------------------------------------------------

function FreeCashFlowSection({ fcf }: { fcf: FreeCashFlow }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Free cash flow"
        description="Depuis le tableau de flux de trésorerie déjà réconcilié."
      />
      <Table header="Free cash flow">
        <Row label="Flux net de trésorerie d'exploitation" value={formatMoneyFr(fcf.fluxExploitation)} />
        <Row
          label="− Cash payé pour les acquisitions"
          caption="Acquisitions + Variation TVA déductible immobilisations − Variation dettes sur immobilisations"
          value={formatMoneyFr(fcf.cashPaidForAcquisitions)}
          muted
        />
        <TotalRow label="= Free cash flow" value={formatMoneyFr(fcf.freeCashFlow)} />
      </Table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Endettement / capitaux / book EV — negative book EV is a legitimate,
// net-cash state, flagged honestly rather than hidden or shown as an error.
// ---------------------------------------------------------------------------

function EndettementSection({ endettement }: { endettement: EndettementEtCapitaux }) {
  const netCash = isNegativeMoney(endettement.endettementNet);
  const bookEvNegative = isNegativeMoney(endettement.bookEnterpriseValue);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Endettement et capitaux propres"
        description="Chiffres comptables — les entrées déterministes qu'un futur module de valorisation consommera. Book EV ci-dessous est basé sur le bilan, ce n'est PAS une valorisation."
      />
      <Table header="Endettement et capitaux">
        <Row
          label="Dettes financières"
          caption="Emprunts et dettes auprès des établissements de crédit (DS+DT+DU+DV)"
          value={formatMoneyFr(endettement.dettesFinancieres)}
        />
        <Row
          label="− Trésorerie et équivalents"
          caption="Disponibilités (CF) + valeurs mobilières de placement (CD, net)"
          value={formatMoneyFr(endettement.tresorerieEtEquivalents)}
          muted
        />
        <TotalRow
          label={netCash ? '= Endettement net (position de trésorerie nette)' : '= Endettement net'}
          value={formatMoneyFr(endettement.endettementNet)}
        />
        <Row
          label="Capitaux propres (book equity)"
          caption="Capitaux propres (DA-DK) + Résultat de l'exercice (DI)"
          value={formatMoneyFr(endettement.capitauxPropres)}
        />
        <TotalRow
          label={bookEvNegative ? '= Book Enterprise Value (négatif — voir note)' : '= Book Enterprise Value'}
          caption="Capitaux propres + Endettement net — book-based, pas une valorisation"
          value={formatMoneyFr(endettement.bookEnterpriseValue)}
        />
      </Table>
      {(netCash || bookEvNegative) && (
        <div className="rounded-md bg-accent-soft px-4 py-2.5 text-[12.5px] text-ink">
          Endettement net négatif : la société détient plus de trésorerie que de dettes financières
          (position de trésorerie nette). {bookEvNegative && 'Cela fait passer le book EV en dessous de zéro — un état légitime pour une société très liquide, pas une erreur de calcul.'}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cost of debt
// ---------------------------------------------------------------------------

function CoutDeLaDetteSection({ cout, dettesFinancieres }: { cout: CoutDeLaDette; dettesFinancieres: string }) {
  const naReason = isZeroMoney(dettesFinancieres);
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title="Coût de la dette" description="Charges d'intérêts ÷ dettes financières." />
      <Table header="Coût de la dette">
        <Row label="Charges d'intérêts" caption="Intérêts et charges assimilées (GR)" value={formatMoneyFr(cout.chargesDInteret)} />
        <Row label="Dettes financières" value={formatMoneyFr(cout.dettesFinancieres)} />
        <TotalRow
          label={cout.taux === null ? '= Taux (n/a — dettes financières nulles)' : '= Taux'}
          value={formatPercent(cout.taux)}
        />
      </Table>
      {naReason && (
        <p className="text-[11.5px] text-ink-faint">
          « n/a » : dettes financières nulles, pas une division par une valeur proche de zéro qui
          aurait explosé le résultat.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ratios — grouped by family, each with its own derivation caption. ROCE is
// annotated when the book EV denominator is negative, since a negative
// "capital employed" flips the usual interpretation of the percentage.
// ---------------------------------------------------------------------------

function RatioRow({ label, caption, value }: { label: string; caption: string; value: string }) {
  return <Row label={label} caption={caption} value={value} />;
}

function RatiosSection({ ratios, endettement }: { ratios: Ratios; endettement: EndettementEtCapitaux }) {
  const bookEvNegative = isNegativeMoney(endettement.bookEnterpriseValue);

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Ratios"
        description="Liquidité, solvabilité, rentabilité, activité — chaque ratio garde sa propre formule visible."
      />

      <Table header="Liquidité">
        <RatioRow
          label="Liquidité générale"
          caption="Actif circulant net ÷ dettes court terme (DW+DX+DY+DZ+EA+EB)"
          value={formatRatio(ratios.liquiditeGenerale)}
        />
        <RatioRow
          label="Liquidité réduite"
          caption="(Actif circulant net − stocks nets) ÷ dettes court terme"
          value={formatRatio(ratios.liquiditeReduite)}
        />
      </Table>

      <Table header="Solvabilité">
        <RatioRow
          label="Gearing"
          caption="Endettement net ÷ capitaux propres"
          value={formatPercent(ratios.gearing)}
        />
        <RatioRow
          label="Autonomie financière"
          caption="Capitaux propres ÷ total du bilan"
          value={formatPercent(ratios.autonomieFinanciere)}
        />
      </Table>

      <Table header="Rentabilité">
        <RatioRow label="ROE" caption="Résultat net ÷ capitaux propres" value={formatPercent(ratios.roe)} />
        <RatioRow label="ROA" caption="Résultat net ÷ total du bilan" value={formatPercent(ratios.roa)} />
        <RatioRow
          label={bookEvNegative ? 'ROCE (capitaux employés négatifs)' : 'ROCE'}
          caption="Résultat d'exploitation ÷ Book EV (capitaux propres + endettement net)"
          value={formatPercent(ratios.roce)}
        />
        <RatioRow
          label="Rentabilité d'exploitation"
          caption="Résultat d'exploitation ÷ chiffre d'affaires (identique à la marge d'exploitation)"
          value={formatPercent(ratios.rentabiliteExploitation)}
        />
      </Table>
      {bookEvNegative && (
        <p className="-mt-3 text-[11.5px] text-ink-faint">
          Book EV est négatif (voir « Endettement et capitaux propres » ci-dessus) : le ROCE porte
          alors sur une base négative — le signe du pourcentage ne se lit pas comme un ROCE
          classique. Affiché tel quel, jamais masqué.
        </p>
      )}

      <Table header="Activité">
        <RatioRow
          label="DSO clients"
          caption="Créances clients brutes (BX) ÷ chiffre d'affaires × 365"
          value={formatDays(ratios.dsoClients)}
        />
        <RatioRow
          label="DPO fournisseurs"
          caption="Dettes fournisseurs (DX) ÷ coût des achats (FS+FT+FU+FV+FW) × 365"
          value={formatDays(ratios.dpoFournisseurs)}
        />
        <RatioRow
          label="Rotation des stocks"
          caption="Stocks bruts ÷ coût des achats × 365"
          value={formatDays(ratios.rotationStocks)}
        />
      </Table>
    </section>
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
