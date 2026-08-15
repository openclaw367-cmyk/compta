import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  useCompany,
  useEcritures,
  useFiscalYears,
  useGenerateLiasse,
  useGenerateLiasseSecondary,
} from '../api/queries';
import type {
  Bilan2033A,
  Bilan2050,
  BilanActifLigne,
  CompteResultat2033B,
  CompteResultat2052_2053,
  CompteResultatLigne,
  LiasseAnyResult,
  Tableau2054,
  Tableau2054Ligne,
  Tableau2055,
  Tableau2055Ligne,
  Tableau2056,
  Tableau2056Ligne,
  Tableau2057,
  Tableau2057CadreALigne,
  Tableau2057CadreBLigne,
  Tableau2059A,
} from '../api/types';
import { ApiError } from '../api/client';
import { addMoneyStrings, formatMoneyFr, subtractMoneyStrings } from '../lib/money';

const NO_FISCAL_YEARS: never[] = [];
const NO_ECRITURES: never[] = [];

// ---------------------------------------------------------------------------
// Form-order section grouping — mirrors the printed 2050/2051/2052/2053
// layout (see specs/liasse-2050-implementation-spec.md §2). The backend
// returns actif/passif/lignes flat, in form order; grouping into rubriques
// is purely a display concern, done here rather than re-derived server-side.
// ---------------------------------------------------------------------------

const ACTIF_SECTIONS: { title: string; codes: string[] }[] = [
  { title: 'Immobilisations incorporelles', codes: ['AB', 'CX', 'AF', 'AH', 'AJ', 'AL'] },
  { title: 'Immobilisations corporelles', codes: ['AN', 'AP', 'AR', 'AT', 'AV'] },
  { title: 'Immobilisations financières', codes: ['CS', 'CU', 'BB', 'BD', 'BF', 'BH'] },
  { title: 'Stocks', codes: ['BL', 'BN', 'BP', 'BR', 'BT'] },
  { title: 'Créances et divers', codes: ['BV', 'BX', 'BZ', 'CB', 'CD', 'CF'] },
  { title: 'Comptes de régularisation', codes: ['CH'] },
  { title: "Frais d'émission d'emprunt, primes, écarts de conversion (IV à VI)", codes: ['CW', 'CM', 'CN'] },
];

/** '__DI__' is a sentinel for the Résultat de l'exercice row, which sits between DH and DJ on the real form but isn't in Bilan2050.passif (it's a separate field — see the type's doc comment). */
const PASSIF_SECTIONS: { title: string; codes: string[] }[] = [
  {
    title: 'Capitaux propres',
    codes: ['DA', 'DB', 'DC', 'DD', 'DE', 'DF', 'DG', 'DH', '__DI__', 'DJ', 'DK'],
  },
  { title: 'Autres fonds propres', codes: ['DM', 'DN'] },
  { title: 'Provisions pour risques et charges', codes: ['DP', 'DQ'] },
  { title: 'Dettes', codes: ['DS', 'DT', 'DU', 'DV', 'DW', 'DX', 'DY', 'DZ', 'EA', 'EB'] },
  { title: "Écart de conversion passif", codes: ['ED'] },
];

const CDR_PRODUITS_EXPLOITATION = ['FC', 'FF', 'FI', 'FM', 'FN', 'FO', 'FP', 'F1', 'FQ'];
const CDR_CHARGES_EXPLOITATION = [
  'FS', 'FT', 'FU', 'FV', 'FW', 'FX', 'FY', 'FZ', 'GA', 'GB', 'GC', 'GD', 'G1', 'GE',
];
const CDR_PRODUITS_FINANCIERS = ['GJ', 'GK', 'GL', 'GM', 'GN', 'GO', 'G2'];
const CDR_CHARGES_FINANCIERES = ['GQ', 'GR', 'GS', 'G3', 'GT'];

/**
 * 2054/2055 row grouping — mirrors tableau-2054.ts/tableau-2055.ts's own
 * ROWS_2054/ROWS_2055 order on the backend (see
 * specs/liasse-2054-2055-implementation-spec.md §3d). The two forms
 * don't share row structure for incorporelles on purpose (2054 folds
 * fonds commercial into "autres postes", 2055 gives it its own row) —
 * kept as two separate section lists rather than forced to match.
 */
const TABLEAU_2054_SECTIONS: { title: string; codes: string[] }[] = [
  { title: 'Immobilisations incorporelles', codes: ['FRAIS_ETABLISSEMENT_DEV', 'AUTRES_POSTES_INCORPORELLES'] },
  {
    title: 'Immobilisations corporelles',
    codes: [
      'TERRAINS', 'CONSTRUCTIONS_SOL_PROPRE', 'CONSTRUCTIONS_SOL_AUTRUI', 'CONSTRUCTIONS_INST_GENERALES',
      'INSTALLATIONS_TECHNIQUES', 'AUTRES_CORP_INST_GENERALES', 'AUTRES_CORP_MATERIEL_TRANSPORT',
      'AUTRES_CORP_MATERIEL_BUREAU', 'AUTRES_CORP_EMBALLAGES', 'IMMOS_CORP_EN_COURS', 'AVANCES_ACOMPTES',
    ],
  },
  { title: 'Immobilisations financières', codes: ['AUTRES_PARTICIPATIONS', 'AUTRES_TITRES_IMMOBILISES', 'PRETS_AUTRES_IMMO_FINANCIERES'] },
];

const TABLEAU_2055_SECTIONS: { title: string; codes: string[] }[] = [
  { title: 'Immobilisations incorporelles', codes: ['FRAIS_ETABLISSEMENT_DEV', 'FONDS_COMMERCIAL', 'AUTRES_INCORPORELLES'] },
  {
    title: 'Immobilisations corporelles',
    codes: [
      'TERRAINS', 'CONSTRUCTIONS_SOL_PROPRE', 'CONSTRUCTIONS_SOL_AUTRUI', 'CONSTRUCTIONS_INST_GENERALES',
      'INSTALLATIONS_TECHNIQUES', 'AUTRES_CORP_INST_GENERALES', 'AUTRES_CORP_MATERIEL_TRANSPORT',
      'AUTRES_CORP_MATERIEL_BUREAU', 'AUTRES_CORP_EMBALLAGES',
    ],
  },
];

/** Every bilan Actif line that's an immobilisation — see liasse-articulation.ts's IMMOBILISATION_BILAN_CODES on the backend (kept in sync by hand, same list). */
const IMMOBILISATION_BILAN_CODES = [
  'AB', 'CX', 'AF', 'AH', 'AJ', 'AL', 'AN', 'AP', 'AR', 'AT', 'AV', 'CS', 'CU', 'BB', 'BD', 'BF', 'BH',
];

/**
 * DK (provisions réglementées) + DP (provisions pour risques) + DQ
 * (provisions pour charges) on the bilan passif = 2056's TOTAL I +
 * TOTAL II exactly (provisions réglementées, and risques et charges).
 * TOTAL III (dépréciations) has no equivalent here — it's embedded in
 * the bilan's actif "amortissements" columns mixed with ordinary 28x
 * amortissement, so there's no clean bilan-only figure to compare
 * against in the browser (see tableau-2056.ts's doc comment on the
 * backend); that portion is verified server-side only.
 */
const PROVISION_BILAN_CODES = ['DK', 'DP', 'DQ'];

/**
 * 2056 row grouping — mirrors tableau-2056.ts's TOTAL_I_CODES/
 * TOTAL_II_CODES/TOTAL_III_CODES on the backend (see
 * specs/liasse-2056-2059-implementation-spec.md §2), in the CERFA
 * form's own section order (provisions réglementées, provisions pour
 * risques et charges, provisions pour dépréciation).
 */
const TABLEAU_2056_SECTIONS: { title: string; totalCode: 'totalReglementees' | 'totalRisquesCharges' | 'totalDepreciation'; totalLabel: string; codes: string[] }[] = [
  {
    title: 'Provisions réglementées',
    totalCode: 'totalReglementees',
    totalLabel: 'TOTAL I',
    codes: ['RECONSTITUTION_GISEMENTS', 'INVESTISSEMENT', 'HAUSSE_PRIX', 'AMORTISSEMENTS_DEROGATOIRES', 'AUTRES_REGLEMENTEES'],
  },
  {
    title: 'Provisions pour risques et charges',
    totalCode: 'totalRisquesCharges',
    totalLabel: 'TOTAL II',
    codes: [
      'LITIGES', 'GARANTIES_CLIENTS', 'AMENDES_PENALITES', 'PERTES_CHANGE', 'PENSIONS',
      'IMPOTS', 'RENOUVELLEMENT_IMMOBILISATIONS', 'GROS_ENTRETIEN', 'AUTRES_RISQUES_CHARGES',
    ],
  },
  {
    title: 'Provisions pour dépréciation',
    totalCode: 'totalDepreciation',
    totalLabel: 'TOTAL III',
    codes: [
      'DEPREC_INCORPORELLES', 'DEPREC_CORPORELLES', 'DEPREC_TITRES_PARTICIPATION',
      'DEPREC_AUTRES_IMMO_FINANCIERES', 'DEPREC_STOCKS_EN_COURS', 'DEPREC_COMPTES_CLIENTS', 'DEPREC_AUTRES',
    ],
  },
];

const REGIME_LABEL: Record<'REEL_NORMAL' | 'REEL_SIMPLIFIE', string> = {
  REEL_NORMAL: 'réel normal (2050/2052)',
  REEL_SIMPLIFIE: 'réel simplifié (2033-A/2033-B)',
};

export function LiassePage() {
  const companyQuery = useCompany();
  const fiscalYearsQuery = useFiscalYears();
  const ecrituresQuery = useEcritures();
  const generateLiasse = useGenerateLiasse();
  const generateSecondary = useGenerateLiasseSecondary();

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

  const canGenerate = Boolean(fiscalYearId) && draftsInYear.length === 0 && !generateLiasse.isPending;

  async function handleGenerate() {
    if (!fiscalYearId) return;
    setError(null);
    try {
      await generateLiasse.mutateAsync({ fiscalYearId });
      // Comparison view — deliberately not awaited into the same try/catch: its own
      // isPending/isError state (surfaced by ComparisonSection) is independent, so a failure here
      // must never touch the primary result above. See useGenerateLiasseSecondary's doc comment.
      void generateSecondary.mutateAsync({ fiscalYearId }).catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['Le calcul a échoué.']);
    }
  }

  const isLoading = companyQuery.isLoading || fiscalYearsQuery.isLoading || ecrituresQuery.isLoading;
  const result = generateLiasse.data ?? null;
  const officialRegime = companyQuery.data?.regime;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Liasse fiscale</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Calcule et affiche, n'écrit jamais dans le journal
          {officialRegime && <> — régime officiel : {REGIME_LABEL[officialRegime]}</>}.
        </p>
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Chargement…
        </div>
      ) : fiscalYears.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Aucun exercice — créez-en un dans « Exercices » pour générer une liasse.
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
              {generateLiasse.isPending ? 'Calcul…' : 'Générer'}
            </button>
          </div>

          {draftsInYear.length > 0 && (
            <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
              {draftsInYear.length === 1
                ? "1 écriture en brouillon bloque le calcul : une écriture non validée dans " +
                  "l'exercice empêche toute la liasse, elle ne saute jamais silencieusement les " +
                  'brouillons. Validez-la ou supprimez-la pour continuer.'
                : `${draftsInYear.length} écritures en brouillon bloquent le calcul : une ` +
                  "écriture non validée dans l'exercice empêche toute la liasse, elle ne saute " +
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
          {result.regime === 'REEL_NORMAL' ? (
            <>
              <BalanceBanner totalActifNet={result.bilan.totalActifNet} totalPassif={result.bilan.totalPassif} />
              <BilanSection bilan={result.bilan} />
              <CompteResultatSection compteResultat={result.compteResultat} />
              <TableauxArticulationBanner
                bilan={result.bilan}
                tableau2054={result.tableau2054}
                tableau2055={result.tableau2055}
              />
              <Tableau2054Section tableau2054={result.tableau2054} />
              <Tableau2055Section tableau2055={result.tableau2055} />
              <Tableau2056ArticulationBanner bilan={result.bilan} tableau2056={result.tableau2056} />
              <Tableau2056Section tableau2056={result.tableau2056} />
              <Tableau2057ArticulationBanner bilan={result.bilan} tableau2057={result.tableau2057} />
              <Tableau2057Section tableau2057={result.tableau2057} />
              <Tableau2059Section tableau2059={result.tableau2059} />
            </>
          ) : (
            <>
              <BalanceBanner totalActifNet={result.bilan.totalActifNet} totalPassif={result.bilan.totalPassif} />
              <Bilan2033ASection bilan={result.bilan} />
              <CompteResultat2033BSection compteResultat={result.compteResultat} />
            </>
          )}

          <ComparisonSection
            isPending={generateSecondary.isPending}
            isError={generateSecondary.isError}
            errorMessage={
              generateSecondary.error instanceof ApiError
                ? generateSecondary.error.message
                : 'Erreur inconnue.'
            }
            result={generateSecondary.data ?? null}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison view — the OTHER regime's bilan + compte de résultat only (no
// annexes even when the comparison regime is RÉEL_NORMAL), computed from the
// same ledger via a separate mutation/endpoint so a failure here can never
// affect the primary, official result above — see
// useGenerateLiasseSecondary's doc comment.
// ---------------------------------------------------------------------------

function ComparisonSection({
  isPending,
  isError,
  errorMessage,
  result,
}: {
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  result: LiasseAnyResult | null;
}) {
  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
        Calcul de la vue de comparaison…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
        La vue de comparaison n'a pas pu être calculée ({errorMessage}) — la liasse officielle
        ci-dessus n'est pas affectée.
      </div>
    );
  }
  if (!result) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4 border-t-2 border-dashed border-border pt-8">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">
          Vue de comparaison — régime {REGIME_LABEL[result.regime]}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Calculée sur le même exercice, à titre indicatif — bilan et compte de résultat
          uniquement, sans les annexes. Ne remplace pas le régime officiel de la société.
        </p>
      </div>
      <BalanceBanner totalActifNet={result.bilan.totalActifNet} totalPassif={result.bilan.totalPassif} />
      {result.regime === 'REEL_NORMAL' ? (
        <>
          <BilanSection bilan={result.bilan} />
          <CompteResultatSection compteResultat={result.compteResultat} />
        </>
      ) : (
        <>
          <Bilan2033ASection bilan={result.bilan} />
          <CompteResultat2033BSection compteResultat={result.compteResultat} />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Balance status — surfaced prominently per instruction. If the API call
// succeeded at all, this always holds: LiasseService refuses (throws)
// rather than returning an unbalanced bilan (see liasse-articulation.ts).
// Shown as an honest confirmation of that computed result, not a live
// client-side check.
// ---------------------------------------------------------------------------

function BalanceBanner({
  totalActifNet,
  totalPassif,
}: {
  totalActifNet: string;
  totalPassif: string;
}) {
  const balances = totalActifNet === totalPassif;
  return (
    <div
      className={[
        'flex items-center justify-between rounded-lg border p-5',
        balances ? 'border-positive-soft bg-positive-soft' : 'border-negative-soft bg-negative-soft',
      ].join(' ')}
    >
      <div>
        <div
          className={[
            'text-[11px] font-semibold uppercase tracking-wide',
            balances ? 'text-positive' : 'text-negative',
          ].join(' ')}
        >
          {balances ? 'Bilan équilibré' : 'Bilan déséquilibré'}
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Actif net {balances ? '=' : '≠'} Passif total
        </p>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] tabular-nums text-ink-muted">
          {formatMoneyFr(totalActifNet)}
        </span>
        <span className={['text-[15px]', balances ? 'text-positive' : 'text-negative'].join(' ')}>
          {balances ? '=' : '≠'}
        </span>
        <span
          className={[
            'text-[22px] font-semibold tabular-nums',
            balances ? 'text-positive' : 'text-negative',
          ].join(' ')}
        >
          {formatMoneyFr(totalPassif)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bilan (2050 Actif / 2051 Passif)
// ---------------------------------------------------------------------------

function BilanSection({ bilan }: { bilan: Bilan2050 }) {
  const actifByCode = new Map(bilan.actif.map((l) => [l.code, l]));
  const passifByCode = new Map(bilan.passif.map((l) => [l.code, l]));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[14px] font-semibold text-ink">Bilan</h2>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Actif — 2050</th>
              <th className="px-4 py-2.5 text-right font-semibold">Brut</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amortissements</th>
              <th className="px-4 py-2.5 text-right font-semibold">Net</th>
            </tr>
          </thead>
          <tbody>
            {ACTIF_SECTIONS.map((section) => (
              <SectionRows key={section.title} title={section.title} colSpan={4}>
                {section.codes.map((code) => {
                  const ligne = actifByCode.get(code);
                  if (!ligne) return null;
                  return <ActifRow key={code} ligne={ligne} />;
                })}
              </SectionRows>
            ))}
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">
                <span className="mr-2 font-medium tabular-nums text-ink-faint">CO / 1A</span>
                Total général (I à VI)
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(bilan.totalActifBrut)}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(bilan.totalActifAmortissements)}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(bilan.totalActifNet)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold" colSpan={2}>
                Passif — 2051
              </th>
            </tr>
          </thead>
          <tbody>
            {PASSIF_SECTIONS.map((section) => (
              <SectionRows key={section.title} title={section.title} colSpan={2}>
                {section.codes.map((code) => {
                  if (code === '__DI__') {
                    return (
                      <PassifRow
                        key={code}
                        code="DI"
                        label="Résultat de l'exercice (bénéfice ou perte)"
                        montant={bilan.resultatDeLExercice}
                        emphasize
                      />
                    );
                  }
                  const ligne = passifByCode.get(code);
                  if (!ligne) return null;
                  return <PassifRow key={code} code={ligne.code} label={ligne.label} montant={ligne.montant} />;
                })}
              </SectionRows>
            ))}
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">
                <span className="mr-2 font-medium tabular-nums text-ink-faint">EE</span>
                Total général (I à V)
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(bilan.totalPassif)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActifRow({ ligne }: { ligne: BilanActifLigne }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 text-ink">
        <span className="mr-2 font-medium tabular-nums text-ink-faint">{ligne.code}</span>
        {ligne.label}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.brut)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.amortissements)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink">{formatMoneyFr(ligne.net)}</td>
    </tr>
  );
}

function PassifRow({
  code,
  label,
  montant,
  emphasize,
}: {
  code: string;
  label: string;
  montant: string;
  emphasize?: boolean;
}) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className={['px-4 py-2', emphasize ? 'font-semibold text-ink' : 'text-ink'].join(' ')}>
        <span className="mr-2 font-medium tabular-nums text-ink-faint">{code}</span>
        {label}
      </td>
      <td
        className={[
          'px-4 py-2 text-right tabular-nums',
          emphasize ? 'font-semibold text-ink' : 'text-ink',
        ].join(' ')}
      >
        {formatMoneyFr(montant)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Bilan simplifié (2033-A) — régime réel simplifié. Coarser line set than
// 2050/2051 (see bilan-2033-a.ts's doc comment); ActifRow/PassifRow above
// are reused as-is since Bilan2033AActifLigne/Bilan2033APassifLigne share
// the same field shapes as their 2050-series counterparts.
// ---------------------------------------------------------------------------

const ACTIF_2033A_SECTIONS: { title: string; codes: string[] }[] = [
  { title: 'Actif immobilisé', codes: ['010', '014', '028', '040'] },
  { title: 'Actif circulant', codes: ['050', '060', '064', '068', '072', '092', '080', '084'] },
];

/** '__RESULTAT__' is a sentinel for the Résultat de l'exercice row (136), which sits between 134 (Report à nouveau) and 137 (Subventions) on the form but isn't in Bilan2033A.passif — same convention as bilan-2050's '__DI__'. */
const PASSIF_2033A_CAPITAUX_CODES = ['120', '124', '126', '130', '132', '134', '__RESULTAT__', '137', '140'];
const PASSIF_2033A_DETTES_CODES = ['156', '164', '166', '172', '173', '175', '174'];

function Bilan2033ASection({ bilan }: { bilan: Bilan2033A }) {
  const actifByCode = new Map(bilan.actif.map((l) => [l.code, l]));
  const passifByCode = new Map(bilan.passif.map((l) => [l.code, l]));
  const totalICapitauxPropres = addMoneyStrings(
    bilan.totalIPassifExcludingResultat,
    bilan.resultatDeLExercice,
  );

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[14px] font-semibold text-ink">Bilan simplifié — 2033-A</h2>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Actif</th>
              <th className="px-4 py-2.5 text-right font-semibold">Brut</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amortissements</th>
              <th className="px-4 py-2.5 text-right font-semibold">Net</th>
            </tr>
          </thead>
          <tbody>
            {ACTIF_2033A_SECTIONS.map((section) => (
              <SectionRows key={section.title} title={section.title} colSpan={4}>
                {section.codes.map((code) => {
                  const ligne = actifByCode.get(code);
                  if (!ligne) return null;
                  return <ActifRow key={code} ligne={ligne} />;
                })}
              </SectionRows>
            ))}
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">
                <span className="mr-2 font-medium tabular-nums text-ink-faint">110/112</span>
                Total général (I + II)
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(bilan.totalActifBrut)}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(bilan.totalActifAmortissements)}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(bilan.totalActifNet)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold" colSpan={2}>
                Passif
              </th>
            </tr>
          </thead>
          <tbody>
            <SectionRows title="Capitaux propres" colSpan={2}>
              {PASSIF_2033A_CAPITAUX_CODES.map((code) => {
                if (code === '__RESULTAT__') {
                  return (
                    <PassifRow
                      key={code}
                      code="136"
                      label="Résultat de l'exercice (bénéfice ou perte)"
                      montant={bilan.resultatDeLExercice}
                      emphasize
                    />
                  );
                }
                const ligne = passifByCode.get(code);
                if (!ligne) return null;
                return (
                  <PassifRow key={code} code={ligne.code} label={ligne.label} montant={ligne.montant} />
                );
              })}
              <tr className="border-b border-border bg-bg">
                <td className="px-4 py-2.5 font-semibold text-ink">
                  <span className="mr-2 font-medium tabular-nums text-ink-faint">142</span>
                  Total I
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                  {formatMoneyFr(totalICapitauxPropres)}
                </td>
              </tr>
            </SectionRows>
            <SectionRows title="Provisions pour risques et charges" colSpan={2}>
              <tr className="border-b border-border bg-bg">
                <td className="px-4 py-2.5 font-semibold text-ink">
                  <span className="mr-2 font-medium tabular-nums text-ink-faint">154</span>
                  Total II
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                  {formatMoneyFr(bilan.totalIIPassif)}
                </td>
              </tr>
            </SectionRows>
            <SectionRows title="Dettes" colSpan={2}>
              {PASSIF_2033A_DETTES_CODES.map((code) => {
                const ligne = passifByCode.get(code);
                if (!ligne) return null;
                return (
                  <PassifRow key={code} code={ligne.code} label={ligne.label} montant={ligne.montant} />
                );
              })}
              <tr className="border-b border-border bg-bg">
                <td className="px-4 py-2.5 font-semibold text-ink">
                  <span className="mr-2 font-medium tabular-nums text-ink-faint">176</span>
                  Total III
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                  {formatMoneyFr(bilan.totalIIIPassif)}
                </td>
              </tr>
            </SectionRows>
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">
                <span className="mr-2 font-medium tabular-nums text-ink-faint">180</span>
                Total général (I + II + III)
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(bilan.totalPassif)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compte de résultat simplifié (2033-B) — "A - RÉSULTAT COMPTABLE" section
// only (cases 209–310), see compte-resultat-2033-b.ts's doc comment for why
// "B - RÉSULTAT FISCAL" isn't built. renderCdrRow/CdrTotalRow (defined
// below, alongside the 2052/2053 section) are reused as-is.
// ---------------------------------------------------------------------------

const CDR_2033B_PRODUITS_EXPLOITATION = ['210', '214', '218', '222', '224', '226', '230'];
const CDR_2033B_CHARGES_EXPLOITATION = [
  '234', '236', '238', '240', '242', '244', '250', '252', '254', '256', '262',
];

function CompteResultat2033BSection({ compteResultat }: { compteResultat: CompteResultat2033B }) {
  const byCode = new Map(compteResultat.lignes.map((l) => [l.code, l]));
  const isPerte = compteResultat.beneficeOuPerte.startsWith('-');

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[14px] font-semibold text-ink">Compte de résultat simplifié — 2033-B</h2>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold" colSpan={2}>
                A — Résultat comptable
              </th>
            </tr>
          </thead>
          <tbody>
            <SectionRows title="Produits d'exploitation" colSpan={2}>
              {CDR_2033B_PRODUITS_EXPLOITATION.map((code) => renderCdrRow(byCode.get(code)))}
            </SectionRows>
            <CdrTotalRow
              code="232"
              label="Total des produits d'exploitation hors TVA (I)"
              montant={compteResultat.totalProduitsExploitation}
            />
            <SectionRows title="Charges d'exploitation" colSpan={2}>
              {CDR_2033B_CHARGES_EXPLOITATION.map((code) => renderCdrRow(byCode.get(code)))}
            </SectionRows>
            <CdrTotalRow
              code="264"
              label="Total des charges d'exploitation (II)"
              montant={compteResultat.totalChargesExploitation}
            />
            <CdrTotalRow
              code="270"
              label="1 — Résultat d'exploitation (I − II)"
              montant={compteResultat.resultatExploitation}
              strong
            />
            <CdrTotalRow code="280" label="Produits financiers (III)" montant={compteResultat.produitsFinanciers} />
            <CdrTotalRow code="294" label="Charges financières (V)" montant={compteResultat.chargesFinancieres} />
            <CdrTotalRow code="290" label="Produits exceptionnels (IV)" montant={compteResultat.produitsExceptionnels} />
            <CdrTotalRow code="300" label="Charges exceptionnelles (VI)" montant={compteResultat.chargesExceptionnelles} />
            <CdrTotalRow code="306" label="Impôt sur les bénéfices (VII)" montant={compteResultat.impotSurLesBenefices} />
          </tbody>
        </table>
      </div>

      <div
        className={[
          'flex items-center justify-between rounded-lg border p-5',
          isPerte ? 'border-negative-soft bg-negative-soft' : 'border-positive-soft bg-positive-soft',
        ].join(' ')}
      >
        <div>
          <div
            className={[
              'text-[11px] font-semibold uppercase tracking-wide',
              isPerte ? 'text-negative' : 'text-positive',
            ].join(' ')}
          >
            2 — {isPerte ? 'Perte' : 'Bénéfice'}
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            310 — Produits (I + III + IV) − Charges (II + V + VI + VII). Reporté au bilan, ligne 136
            (Résultat de l'exercice).
          </p>
        </div>
        <div
          className={[
            'text-[22px] font-semibold tabular-nums',
            isPerte ? 'text-negative' : 'text-positive',
          ].join(' ')}
        >
          {formatMoneyFr(compteResultat.beneficeOuPerte)}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compte de résultat (2052/2053)
// ---------------------------------------------------------------------------

function CompteResultatSection({ compteResultat }: { compteResultat: CompteResultat2052_2053 }) {
  const byCode = new Map(compteResultat.lignes.map((l) => [l.code, l]));
  const isPerte = compteResultat.beneficeOuPerte.startsWith('-');

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[14px] font-semibold text-ink">Compte de résultat</h2>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold" colSpan={2}>
                2052 — Exploitation, opérations en commun, financier
              </th>
            </tr>
          </thead>
          <tbody>
            <SectionRows title="Produits d'exploitation" colSpan={2}>
              {CDR_PRODUITS_EXPLOITATION.map((code) => renderCdrRow(byCode.get(code)))}
            </SectionRows>
            <CdrTotalRow code="FR" label="Total des produits d'exploitation (I)" montant={compteResultat.totalProduitsExploitation} />
            <SectionRows title="Charges d'exploitation" colSpan={2}>
              {CDR_CHARGES_EXPLOITATION.map((code) => renderCdrRow(byCode.get(code)))}
            </SectionRows>
            <CdrTotalRow code="GF" label="Total des charges d'exploitation (II)" montant={compteResultat.totalChargesExploitation} />
            <CdrTotalRow code="GG" label="1 — Résultat d'exploitation (I − II)" montant={compteResultat.resultatExploitation} strong />
            <SectionRows title="Produits financiers" colSpan={2}>
              {CDR_PRODUITS_FINANCIERS.map((code) => renderCdrRow(byCode.get(code)))}
            </SectionRows>
            <CdrTotalRow code="GP" label="Total des produits financiers (V)" montant={compteResultat.totalProduitsFinanciers} />
            <SectionRows title="Charges financières" colSpan={2}>
              {CDR_CHARGES_FINANCIERES.map((code) => renderCdrRow(byCode.get(code)))}
            </SectionRows>
            <CdrTotalRow code="GU" label="Total des charges financières (VI)" montant={compteResultat.totalChargesFinancieres} />
            <CdrTotalRow code="GV" label="2 — Résultat financier (V − VI)" montant={compteResultat.resultatFinancier} strong />
            <CdrTotalRow
              code="GW"
              label="3 — Résultat courant avant impôts (I − II + III − IV + V − VI)"
              montant={compteResultat.resultatCourantAvantImpots}
              strong
            />
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold" colSpan={2}>
                2053 — Exceptionnel, impôts, résultat
              </th>
            </tr>
          </thead>
          <tbody>
            {renderCdrRow(byCode.get('HD'), 'Produits exceptionnels (VII)')}
            {renderCdrRow(byCode.get('HH'), 'Charges exceptionnelles (VIII)')}
            <CdrTotalRow code="HI" label="4 — Résultat exceptionnel (VII − VIII)" montant={compteResultat.resultatExceptionnel} strong />
            {renderCdrRow(byCode.get('HJ'), 'Participation des salariés aux résultats (IX)')}
            {renderCdrRow(byCode.get('HK'), 'Impôts sur les bénéfices (X)')}
            <CdrTotalRow code="HL" label="Total des produits (I + III + V + VII)" montant={compteResultat.totalProduits} />
            <CdrTotalRow code="HM" label="Total des charges (II + IV + VI + VIII + IX + X)" montant={compteResultat.totalCharges} />
          </tbody>
        </table>
      </div>

      <div
        className={[
          'flex items-center justify-between rounded-lg border p-5',
          isPerte ? 'border-negative-soft bg-negative-soft' : 'border-positive-soft bg-positive-soft',
        ].join(' ')}
      >
        <div>
          <div
            className={[
              'text-[11px] font-semibold uppercase tracking-wide',
              isPerte ? 'text-negative' : 'text-positive',
            ].join(' ')}
          >
            5 — {isPerte ? 'Perte' : 'Bénéfice'}
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            HN — total des produits − total des charges. Reporté au bilan, ligne DI (Résultat de
            l'exercice).
          </p>
        </div>
        <div
          className={[
            'text-[22px] font-semibold tabular-nums',
            isPerte ? 'text-negative' : 'text-positive',
          ].join(' ')}
        >
          {formatMoneyFr(compteResultat.beneficeOuPerte)}
        </div>
      </div>
    </section>
  );
}

function renderCdrRow(ligne: CompteResultatLigne | undefined, overrideLabel?: string) {
  if (!ligne) return null;
  return (
    <tr key={ligne.code} className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 text-ink">
        <span className="mr-2 font-medium tabular-nums text-ink-faint">{ligne.code}</span>
        {overrideLabel ?? ligne.label}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink">{formatMoneyFr(ligne.montant)}</td>
    </tr>
  );
}

function CdrTotalRow({
  code,
  label,
  montant,
  strong,
}: {
  code: string;
  label: string;
  montant: string;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? 'border-b border-border bg-bg' : 'border-b border-border'}>
      <td className={['px-4 py-2.5', strong ? 'font-semibold text-ink' : 'font-medium text-ink'].join(' ')}>
        <span className="mr-2 font-medium tabular-nums text-ink-faint">{code}</span>
        {label}
      </td>
      <td
        className={[
          'px-4 py-2.5 text-right tabular-nums',
          strong ? 'font-semibold text-ink' : 'font-medium text-ink',
        ].join(' ')}
      >
        {formatMoneyFr(montant)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 2054 (Immobilisations) / 2055 (Amortissements) — movement annexes.
// Cessions (2054) / diminutions (2055) are always 0,00 — no cession
// logic exists yet, stated per-column rather than hidden.
// ---------------------------------------------------------------------------

/**
 * The annexe's version of the bilan's Actif=Passif banner: 2054's
 * ending brut minus 2055's ending amortissements, summed across every
 * category, against the bilan's own total immobilisations net. If the
 * API call succeeded at all this always holds — LiasseService refuses
 * rather than returning tables that don't tie (see
 * assertTableauxTieToBilan on the backend) — shown here as a
 * confirmation of that computed result, not a live client-side check,
 * same convention as BalanceBanner above.
 */
function TableauxArticulationBanner({
  bilan,
  tableau2054,
  tableau2055,
}: {
  bilan: Bilan2050;
  tableau2054: Tableau2054;
  tableau2055: Tableau2055;
}) {
  const bilanImmobilisationsNet = bilan.actif
    .filter((l) => IMMOBILISATION_BILAN_CODES.includes(l.code))
    .reduce((sum, l) => addMoneyStrings(sum, l.net), '0.00');
  const tableauxNet = subtractMoneyStrings(tableau2054.totalGeneral, tableau2055.totalGeneral);
  const ties = bilanImmobilisationsNet === tableauxNet;

  return (
    <div
      className={[
        'flex items-center justify-between rounded-lg border p-5',
        ties ? 'border-positive-soft bg-positive-soft' : 'border-negative-soft bg-negative-soft',
      ].join(' ')}
    >
      <div>
        <div
          className={[
            'text-[11px] font-semibold uppercase tracking-wide',
            ties ? 'text-positive' : 'text-negative',
          ].join(' ')}
        >
          {ties ? 'Annexes 2054/2055 cohérentes avec le bilan' : 'Annexes 2054/2055 incohérentes avec le bilan'}
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          2054 (valeur brute fin) − 2055 (amortissements fin) {ties ? '=' : '≠'} total des
          immobilisations nettes du bilan
        </p>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] tabular-nums text-ink-muted">{formatMoneyFr(tableauxNet)}</span>
        <span className={['text-[15px]', ties ? 'text-positive' : 'text-negative'].join(' ')}>
          {ties ? '=' : '≠'}
        </span>
        <span
          className={[
            'text-[22px] font-semibold tabular-nums',
            ties ? 'text-positive' : 'text-negative',
          ].join(' ')}
        >
          {formatMoneyFr(bilanImmobilisationsNet)}
        </span>
      </div>
    </div>
  );
}

function Tableau2054Section({ tableau2054 }: { tableau2054: Tableau2054 }) {
  const byCode = new Map(tableau2054.lignes.map((l) => [l.code, l]));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">2054 — Immobilisations</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Mouvements de l'exercice sur la valeur brute des immobilisations.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Immobilisations</th>
              <th className="px-4 py-2.5 text-right font-semibold">Début d'exercice</th>
              <th className="px-4 py-2.5 text-right font-semibold">Acquisitions</th>
              <th className="px-4 py-2.5 text-right font-semibold">Cessions</th>
              <th className="px-4 py-2.5 text-right font-semibold">Fin d'exercice</th>
            </tr>
          </thead>
          <tbody>
            {TABLEAU_2054_SECTIONS.map((section) => (
              <SectionRows key={section.title} title={section.title} colSpan={5}>
                {section.codes.map((code) => {
                  const ligne = byCode.get(code);
                  if (!ligne) return null;
                  return <Tableau2054Row key={code} ligne={ligne} />;
                })}
              </SectionRows>
            ))}
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">Total général (I+II+III+IV)</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(tableau2054.totalGeneral)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-ink-faint">
        La colonne Cessions reflète les immobilisations cédées au cours de l'exercice (voir « Cession
        d'immobilisation » sur la fiche de l'actif). Les virements de poste à poste affichent
        toujours 0,00 € — aucune fonctionnalité de reclassement d'immobilisation n'existe.
      </p>
    </section>
  );
}

function Tableau2054Row({ ligne }: { ligne: Tableau2054Ligne }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 text-ink">{ligne.label}</td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.valeurBruteDebut)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.acquisitions)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.cessions)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink">
        {formatMoneyFr(ligne.valeurBruteFin)}
      </td>
    </tr>
  );
}

function Tableau2055Section({ tableau2055 }: { tableau2055: Tableau2055 }) {
  const byCode = new Map(tableau2055.lignes.map((l) => [l.code, l]));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">2055 — Amortissements</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Mouvements de l'exercice sur les amortissements techniques.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Amortissements</th>
              <th className="px-4 py-2.5 text-right font-semibold">Début d'exercice</th>
              <th className="px-4 py-2.5 text-right font-semibold">Dotations</th>
              <th className="px-4 py-2.5 text-right font-semibold">Reprises</th>
              <th className="px-4 py-2.5 text-right font-semibold">Fin d'exercice</th>
            </tr>
          </thead>
          <tbody>
            {TABLEAU_2055_SECTIONS.map((section) => (
              <SectionRows key={section.title} title={section.title} colSpan={5}>
                {section.codes.map((code) => {
                  const ligne = byCode.get(code);
                  if (!ligne) return null;
                  return <Tableau2055Row key={code} ligne={ligne} />;
                })}
              </SectionRows>
            ))}
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">Total général (I+II)</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(tableau2055.totalGeneral)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-ink-faint">
        La colonne Reprises reflète les amortissements cumulés des immobilisations cédées au cours
        de l'exercice (voir « Cession d'immobilisation » sur la fiche de l'actif). Le cadre B
        (amortissements dérogatoires) n'est pas applicable : cette application ne calcule que
        l'amortissement linéaire, qui ne peut jamais diverger de l'amortissement fiscal.
      </p>
    </section>
  );
}

function Tableau2055Row({ ligne }: { ligne: Tableau2055Ligne }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 text-ink">{ligne.label}</td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.montantDebut)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.dotations)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.diminutions)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink">
        {formatMoneyFr(ligne.montantFin)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 2056 (Provisions inscrites au bilan) — movement table, same shape as
// 2054/2055 (début/dotations/reprises/fin) but with no dedicated domain
// model behind it: début/dotations/reprises are derived from the ledger
// by journal type (à-nouveau lines = début, everything else = movement)
// rather than a FixedAsset-equivalent — see tableau-2056.ts. The
// articulation banner below only covers TOTAL I + TOTAL II (provisions
// réglementées, risques et charges) against the bilan's DK+DP+DQ — the
// full backend tie-out (assertTableau2056TiesToBilan) also covers TOTAL
// III (dépréciations), but that portion has no bilan-only figure the
// browser can recompute (the bilan's amortissements column mixes 28x
// with 29x per asset line) — see the banner and the note below the table.
// ---------------------------------------------------------------------------

/**
 * Partial client-side check: bilan DK+DP+DQ (provisions réglementées +
 * pour risques + pour charges) must equal 2056's TOTAL I + TOTAL II.
 * Deliberately doesn't cover TOTAL III (dépréciations) — see the
 * section doc comment above for why no bilan-only figure exists for it;
 * that portion is verified server-side only
 * (assertTableau2056TiesToBilan), same "shown as confirmation, not a
 * live check" convention as every other banner on this page.
 */
function Tableau2056ArticulationBanner({
  bilan,
  tableau2056,
}: {
  bilan: Bilan2050;
  tableau2056: Tableau2056;
}) {
  const bilanProvisions = bilan.passif
    .filter((l) => PROVISION_BILAN_CODES.includes(l.code))
    .reduce((sum, l) => addMoneyStrings(sum, l.montant), '0.00');
  const tableauReglementeesEtRisques = addMoneyStrings(
    tableau2056.totalReglementees,
    tableau2056.totalRisquesCharges,
  );
  const ties = bilanProvisions === tableauReglementeesEtRisques;

  return (
    <div
      className={[
        'flex items-center justify-between rounded-lg border p-5',
        ties ? 'border-positive-soft bg-positive-soft' : 'border-negative-soft bg-negative-soft',
      ].join(' ')}
    >
      <div>
        <div
          className={[
            'text-[11px] font-semibold uppercase tracking-wide',
            ties ? 'text-positive' : 'text-negative',
          ].join(' ')}
        >
          {ties
            ? 'Annexe 2056 (I + II) cohérente avec le bilan'
            : 'Annexe 2056 (I + II) incohérente avec le bilan'}
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          2056 (TOTAL I + TOTAL II) {ties ? '=' : '≠'} bilan (provisions réglementées + pour risques
          et charges — DK + DP + DQ). TOTAL III (dépréciations) est vérifié côté serveur uniquement.
        </p>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] tabular-nums text-ink-muted">
          {formatMoneyFr(tableauReglementeesEtRisques)}
        </span>
        <span className={['text-[15px]', ties ? 'text-positive' : 'text-negative'].join(' ')}>
          {ties ? '=' : '≠'}
        </span>
        <span
          className={[
            'text-[22px] font-semibold tabular-nums',
            ties ? 'text-positive' : 'text-negative',
          ].join(' ')}
        >
          {formatMoneyFr(bilanProvisions)}
        </span>
      </div>
    </div>
  );
}

function Tableau2056Section({ tableau2056 }: { tableau2056: Tableau2056 }) {
  const byCode = new Map(tableau2056.lignes.map((l) => [l.code, l]));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">2056 — Provisions</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Mouvements de l'exercice sur les provisions inscrites au bilan.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Nature des provisions</th>
              <th className="px-4 py-2.5 text-right font-semibold">Début d'exercice</th>
              <th className="px-4 py-2.5 text-right font-semibold">Dotations</th>
              <th className="px-4 py-2.5 text-right font-semibold">Reprises</th>
              <th className="px-4 py-2.5 text-right font-semibold">Fin d'exercice</th>
            </tr>
          </thead>
          <tbody>
            {TABLEAU_2056_SECTIONS.map((section) => (
              <SectionRows key={section.title} title={section.title} colSpan={5}>
                {section.codes.map((code) => {
                  const ligne = byCode.get(code);
                  if (!ligne) return null;
                  return <Tableau2056Row key={code} ligne={ligne} />;
                })}
                <tr className="border-b border-border bg-bg">
                  <td className="px-4 py-2.5 font-semibold text-ink">{section.totalLabel}</td>
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                    {formatMoneyFr(tableau2056[section.totalCode])}
                  </td>
                </tr>
              </SectionRows>
            ))}
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">TOTAL GÉNÉRAL (I + II + III)</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(tableau2056.totalGeneral)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-ink-faint">
        La ventilation « dont dotations et reprises d'exploitation / financières / exceptionnelles »
        du formulaire n'est pas calculée : elle nécessiterait de retrouver, pour chaque mouvement, le
        compte de charge ou de produit utilisé en contrepartie — une jointure par écriture que le
        moteur ne fait pas aujourd'hui. La cohérence de TOTAL III (dépréciations) avec le bilan est
        vérifiée côté serveur uniquement, à chaque calcul — voir CLAUDE.md, « Liasse fiscale annexes
        2056/2059 ».
      </p>
    </section>
  );
}

function Tableau2056Row({ ligne }: { ligne: Tableau2056Ligne }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 text-ink">{ligne.label}</td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.montantDebut)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.dotations)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.reprises)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink">
        {formatMoneyFr(ligne.montantFin)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 2057 (État des échéances des créances et des dettes) — montant brut
// only, per nature line; the échéance (maturity) split the form's own
// name is built around is blocked, not just undisplayed — no due-date
// field exists anywhere in the schema (see tableau-2057.ts's doc
// comment, and CLAUDE.md's "Liasse fiscale annexes 2056/2059"). Every
// row here reproduces exactly one bilan actif/passif line, relabeled —
// not the CERFA form's own finer subdivisions (see that same doc
// comment for which splits the chart of accounts can't currently make).
// ---------------------------------------------------------------------------

function Tableau2057ArticulationBanner({
  bilan,
  tableau2057,
}: {
  bilan: Bilan2050;
  tableau2057: Tableau2057;
}) {
  const bilanCreances = bilan.actif
    .filter((l) => ['BB', 'BF', 'BH', 'BV', 'BX', 'BZ', 'CH'].includes(l.code))
    .reduce((sum, l) => addMoneyStrings(sum, l.brut), '0.00');
  const bilanDettes = bilan.passif
    .filter((l) => ['DS', 'DT', 'DU', 'DV', 'DW', 'DX', 'DY', 'DZ', 'EA', 'EB'].includes(l.code))
    .reduce((sum, l) => addMoneyStrings(sum, l.montant), '0.00');
  const tiesCreances = bilanCreances === tableau2057.totalCreances;
  const tiesDettes = bilanDettes === tableau2057.totalDettes;
  const ties = tiesCreances && tiesDettes;

  return (
    <div
      className={[
        'flex items-center justify-between rounded-lg border p-5',
        ties ? 'border-positive-soft bg-positive-soft' : 'border-negative-soft bg-negative-soft',
      ].join(' ')}
    >
      <div>
        <div
          className={[
            'text-[11px] font-semibold uppercase tracking-wide',
            ties ? 'text-positive' : 'text-negative',
          ].join(' ')}
        >
          {ties ? 'Annexe 2057 cohérente avec le bilan' : 'Annexe 2057 incohérente avec le bilan'}
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Cadre A (créances) {tiesCreances ? '=' : '≠'} bilan · Cadre B (dettes) {tiesDettes ? '=' : '≠'}{' '}
          bilan
        </p>
      </div>
      <div className="flex items-baseline gap-6">
        <div className="flex items-baseline gap-3">
          <span className="text-[13px] tabular-nums text-ink-muted">
            {formatMoneyFr(tableau2057.totalCreances)}
          </span>
          <span className={['text-[13px]', tiesCreances ? 'text-positive' : 'text-negative'].join(' ')}>
            {tiesCreances ? '=' : '≠'}
          </span>
          <span
            className={[
              'text-[16px] font-semibold tabular-nums',
              tiesCreances ? 'text-positive' : 'text-negative',
            ].join(' ')}
          >
            {formatMoneyFr(bilanCreances)}
          </span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-[13px] tabular-nums text-ink-muted">
            {formatMoneyFr(tableau2057.totalDettes)}
          </span>
          <span className={['text-[13px]', tiesDettes ? 'text-positive' : 'text-negative'].join(' ')}>
            {tiesDettes ? '=' : '≠'}
          </span>
          <span
            className={[
              'text-[16px] font-semibold tabular-nums',
              tiesDettes ? 'text-positive' : 'text-negative',
            ].join(' ')}
          >
            {formatMoneyFr(bilanDettes)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Tableau2057Section({ tableau2057 }: { tableau2057: Tableau2057 }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">
          2057 — État des créances et des dettes
        </h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Montant brut et échéance par nature à la clôture de l'exercice.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Cadre A — État des créances</th>
              <th className="px-4 py-2.5 text-right font-semibold">Montant brut</th>
              <th className="px-4 py-2.5 text-right font-semibold">
                À un an au plus
                <div className="mt-0.5 text-[10px] font-normal normal-case text-ink-faint">
                  dont échéances non renseignées
                </div>
              </th>
              <th className="px-4 py-2.5 text-right font-semibold">À plus d'un an</th>
            </tr>
          </thead>
          <tbody>
            {tableau2057.cadreA.map((ligne) => (
              <Tableau2057CadreARow key={ligne.code} ligne={ligne} />
            ))}
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">TOTAUX</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(tableau2057.totalCreances)}
              </td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Cadre B — État des dettes</th>
              <th className="px-4 py-2.5 text-right font-semibold">Montant brut</th>
              <th className="px-4 py-2.5 text-right font-semibold">
                À un an au plus
                <div className="mt-0.5 text-[10px] font-normal normal-case text-ink-faint">
                  dont échéances non renseignées
                </div>
              </th>
              <th className="px-4 py-2.5 text-right font-semibold">À plus d'1 an et 5 ans au plus</th>
              <th className="px-4 py-2.5 text-right font-semibold">À plus de 5 ans</th>
            </tr>
          </thead>
          <tbody>
            {tableau2057.cadreB.map((ligne) => (
              <Tableau2057CadreBRow key={ligne.code} ligne={ligne} />
            ))}
            <tr className="bg-bg">
              <td className="px-4 py-2.5 font-semibold text-ink">TOTAUX</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatMoneyFr(tableau2057.totalDettes)}
              </td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-ink-faint">{tableau2057.note}</p>
      <p className="text-[12px] text-ink-faint">{tableau2057.maturityNote}</p>
    </section>
  );
}

function Tableau2057CadreARow({ ligne }: { ligne: Tableau2057CadreALigne }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 text-ink">
        <span className="mr-2 font-medium tabular-nums text-ink-faint">{ligne.code}</span>
        {ligne.label}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink">
        {formatMoneyFr(ligne.montantBrut)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.aUnAnAuPlus)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.aPlusDUnAn)}
      </td>
    </tr>
  );
}

function Tableau2057CadreBRow({ ligne }: { ligne: Tableau2057CadreBLigne }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 text-ink">
        <span className="mr-2 font-medium tabular-nums text-ink-faint">{ligne.code}</span>
        {ligne.label}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink">
        {formatMoneyFr(ligne.montantBrut)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.aUnAnAuPlus)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.aPlusDUnAnEt5AnsAuPlus)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
        {formatMoneyFr(ligne.aPlusDe5Ans)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 2059-A (Détermination des plus et moins-values) — structurally empty,
// not a table with empty rows: every line on the real form is a
// per-disposal line item, and no cession has ever been posted through
// this app (see tableau-2059.ts). Rendered as a status card rather than
// a table with nothing in it.
// ---------------------------------------------------------------------------

function Tableau2059Section({ tableau2059 }: { tableau2059: Tableau2059A }) {
  const hasDisposals = tableau2059.cadreA.length > 0;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">2059-A — Plus et moins-values</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Détermination des plus et moins-values sur cessions d'éléments d'actif.
        </p>
      </div>

      {hasDisposals ? (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-semibold">
                    Cadre A — Valeur résiduelle des éléments cédés
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">Valeur d'origine</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amortissements</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Valeur résiduelle</th>
                </tr>
              </thead>
              <tbody>
                {tableau2059.cadreA.map((row) => (
                  <tr key={row.accountNumber} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2 text-ink">
                      <span className="mr-2 font-medium tabular-nums text-ink-faint">
                        {row.accountNumber}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                      {formatMoneyFr(row.valeurOrigine)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                      {formatMoneyFr(row.amortissements)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink">
                      {formatMoneyFr(row.valeurResiduelle)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-semibold">Cadre B — Plus-values, moins-values</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Prix de vente</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Plus ou moins-value
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">Qualification</th>
                </tr>
              </thead>
              <tbody>
                {tableau2059.cadreB.map((row) => {
                  const isMoinsValue = row.plusOuMoinsValue.startsWith('-');
                  return (
                    <tr key={row.accountNumber} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2 text-ink">
                        <span className="mr-2 font-medium tabular-nums text-ink-faint">
                          {row.accountNumber}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                        {formatMoneyFr(row.prixDeVente)}
                      </td>
                      <td
                        className={[
                          'px-4 py-2 text-right tabular-nums',
                          isMoinsValue ? 'text-negative' : 'text-positive',
                        ].join(' ')}
                      >
                        {formatMoneyFr(row.plusOuMoinsValue)}
                      </td>
                      <td className="px-4 py-2 text-right text-ink-faint">
                        {row.qualification ?? 'non qualifiée'}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-bg">
                  <td className="px-4 py-2.5 font-semibold text-ink">TOTAL (non qualifié)</td>
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                    {formatMoneyFr(tableau2059.totalNonQualifie)}
                  </td>
                  <td className="px-4 py-2.5" />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <p className="text-[13px] text-ink-muted">{tableau2059.note}</p>
        {hasDisposals && (
          <div className="flex flex-wrap gap-8 border-t border-border pt-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Plus/moins-value nette à court terme
              </div>
              <div className="mt-1 text-[16px] font-semibold tabular-nums text-ink">
                {formatMoneyFr(tableau2059.totalCourtTerme)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Plus/moins-value nette à long terme
              </div>
              <div className="mt-1 text-[16px] font-semibold tabular-nums text-ink">
                {formatMoneyFr(tableau2059.totalLongTerme)}
              </div>
            </div>
          </div>
        )}
        <p className="text-[12px] text-ink-faint">
          Cohérence avec le compte de résultat (lignes 775/675) vérifiée côté serveur à chaque
          calcul — si une cession était enregistrée sans être reflétée ici, ou l'inverse, le calcul
          échouerait plutôt que d'afficher un tableau silencieusement faux.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function SectionRows({
  title,
  colSpan,
  children,
}: {
  title: string;
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={colSpan}
          className="bg-bg px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint"
        >
          {title}
        </td>
      </tr>
      {children}
    </>
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
