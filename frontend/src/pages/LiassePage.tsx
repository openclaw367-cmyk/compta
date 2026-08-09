import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useCompany, useEcritures, useFiscalYears, useGenerateLiasse } from '../api/queries';
import type {
  Bilan2050,
  BilanActifLigne,
  CompteResultat2052_2053,
  CompteResultatLigne,
} from '../api/types';
import { ApiError } from '../api/client';
import { formatMoneyFr } from '../lib/money';

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

export function LiassePage() {
  const companyQuery = useCompany();
  const fiscalYearsQuery = useFiscalYears();
  const ecrituresQuery = useEcritures();
  const generateLiasse = useGenerateLiasse();

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

  const regimeSupported = companyQuery.data?.regime === 'REEL_NORMAL';

  const canGenerate =
    Boolean(fiscalYearId) &&
    regimeSupported &&
    draftsInYear.length === 0 &&
    !generateLiasse.isPending;

  async function handleGenerate() {
    if (!fiscalYearId) return;
    setError(null);
    try {
      await generateLiasse.mutateAsync({ fiscalYearId });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['Le calcul a échoué.']);
    }
  }

  const isLoading = companyQuery.isLoading || fiscalYearsQuery.isLoading || ecrituresQuery.isLoading;
  const result = generateLiasse.data ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Liasse fiscale</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Bilan (2050/2051) et compte de résultat (2052/2053), régime réel normal — calcule et
          affiche, n'écrit jamais dans le journal.
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

          {!regimeSupported && (
            <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
              La liasse fiscale au régime réel simplifié (2033-series) n'est pas encore
              implémentée — seul le régime réel normal (2050-series) est disponible. Ce champ se
              règle sur la fiche société.
            </div>
          )}

          {regimeSupported && draftsInYear.length > 0 && (
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
          <BalanceBanner bilan={result.bilan} />
          <BilanSection bilan={result.bilan} />
          <CompteResultatSection compteResultat={result.compteResultat} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balance status — surfaced prominently per instruction. If the API call
// succeeded at all, this always holds: LiasseService refuses (throws)
// rather than returning an unbalanced bilan (see liasse-articulation.ts).
// Shown as an honest confirmation of that computed result, not a live
// client-side check.
// ---------------------------------------------------------------------------

function BalanceBanner({ bilan }: { bilan: Bilan2050 }) {
  const balances = bilan.totalActifNet === bilan.totalPassif;
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
          Actif net (CO − 1A) {balances ? '=' : '≠'} Passif total (EE)
        </p>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] tabular-nums text-ink-muted">
          {formatMoneyFr(bilan.totalActifNet)}
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
          {formatMoneyFr(bilan.totalPassif)}
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
