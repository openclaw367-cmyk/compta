import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useEcritures, useFiscalYears, useGenerateResultatFiscal } from '../api/queries';
import type { ComputeResultatFiscalDto, DeclaredLineDto } from '../api/dto';
import type { ResultatFiscalResult } from '../api/types';
import { ApiError } from '../api/client';
import { formatMoneyFr, normalizeMoneyInput, sanitizeAmountBuffer } from '../lib/money';

const NO_FISCAL_YEARS: never[] = [];
const NO_ECRITURES: never[] = [];

interface ConfirmableState {
  confirmed: boolean;
  value: string;
}

interface DeclaredRow extends DeclaredLineDto {
  id: string;
}

/** Common 2058-A réintégration codes an SME actually declares — see CLAUDE.md's (c) bucket list. "Autre" allows any other form code. */
const REINTEGRATION_CODES: { code: string; label: string }[] = [
  { code: 'WD', label: 'Avantages personnels non déductibles' },
  { code: 'WE', label: 'Amortissements excédentaires (véhicules)' },
  { code: 'WF', label: 'Autres charges et dépenses somptuaires' },
  { code: 'RA', label: 'Loyers à réintégrer (crédit-bail immobilier)' },
  { code: 'WI', label: 'Provisions et charges à payer non déductibles (2058-B, cadre III)' },
  { code: 'XX', label: 'Charges liées à des États et territoires non coopératifs' },
  { code: 'XZ', label: 'Charges financières (art. 39-1-3° et 212 bis)' },
  { code: 'XY', label: 'Réintégrations prévues à l’article 155 du CGI' },
];

const DEDUCTION_CODES: { code: string; label: string }[] = [
  { code: 'WU', label: 'Provisions non déductibles antérieurement taxées (2058-B, cadre III)' },
  { code: 'XA', label: 'Régime des sociétés mères et des filiales' },
  { code: 'ZX', label: 'Produits de participations inéligibles (déductibles à 99%)' },
  { code: 'ZY', label: "Déduction investissements outre-mer" },
  { code: 'XD', label: "Majoration d'amortissement" },
];

const AUTRE_CODE = '__autre__';

function newRowId(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toDeclaredLineDto(row: DeclaredRow): DeclaredLineDto {
  return { code: row.code, label: row.label, montant: row.montant };
}

export function ResultatFiscalPage() {
  const fiscalYearsQuery = useFiscalYears();
  const ecrituresQuery = useEcritures();
  const generate = useGenerateResultatFiscal();

  const fiscalYears = fiscalYearsQuery.data ?? NO_FISCAL_YEARS;
  const ecritures = ecrituresQuery.data ?? NO_ECRITURES;

  const [fiscalYearId, setFiscalYearId] = useState<string | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState(false);
  const [result, setResult] = useState<ResultatFiscalResult | null>(null);

  const [wj, setWj] = useState<ConfirmableState>({ confirmed: false, value: '0.00' });
  const [wg, setWg] = useState<ConfirmableState>({ confirmed: false, value: '0.00' });
  const [declaredReintegrations, setDeclaredReintegrations] = useState<DeclaredRow[]>([]);
  const [declaredDeductions, setDeclaredDeductions] = useState<DeclaredRow[]>([]);

  useEffect(() => {
    if (!fiscalYearId && fiscalYears.length > 0) setFiscalYearId(fiscalYears[0].id);
  }, [fiscalYearId, fiscalYears]);

  const draftsInYear = ecritures.filter(
    (e) => e.fiscalYearId === fiscalYearId && e.validatedAt === null,
  );
  const canGenerate = Boolean(fiscalYearId) && draftsInYear.length === 0 && !generate.isPending;

  function resetWorksheet() {
    setHasGeneratedOnce(false);
    setResult(null);
    setWj({ confirmed: false, value: '0.00' });
    setWg({ confirmed: false, value: '0.00' });
    setDeclaredReintegrations([]);
    setDeclaredDeductions([]);
  }

  async function handleInitialGenerate() {
    if (!fiscalYearId) return;
    setError(null);
    try {
      const initial = await generate.mutateAsync({
        fiscalYearId,
        confirmedAmendesEtPenalites: '0.00',
        confirmedTaxeVehicules: '0.00',
        reintegrationsDeclarees: [],
        deductionsDeclarees: [],
      });
      const wjLine = initial.reintegrationsConfirmables.find((l) => l.code === 'WJ');
      const wgLine = initial.reintegrationsConfirmables.find((l) => l.code === 'WG');
      setWj({ confirmed: false, value: wjLine?.suggested ?? '0.00' });
      setWg({ confirmed: false, value: wgLine?.suggested ?? '0.00' });
      setDeclaredReintegrations([]);
      setDeclaredDeductions([]);
      setResult(initial);
      setHasGeneratedOnce(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['Le calcul a échoué.']);
    }
  }

  // Live recompute: every worksheet edit (confirmation, declared line add/remove/edit) re-asks the
  // backend for the authoritative total — never duplicated client-side, since the server's own
  // Decimal arithmetic is the only source of truth this module has (see CLAUDE.md "Détermination du
  // résultat fiscal" — the arithmetic tie-out is the one real guarantee this module offers).
  useEffect(() => {
    if (!hasGeneratedOnce || !fiscalYearId) return;
    const dto: ComputeResultatFiscalDto = {
      fiscalYearId,
      confirmedAmendesEtPenalites: wj.confirmed ? wj.value : '0.00',
      confirmedTaxeVehicules: wg.confirmed ? wg.value : '0.00',
      reintegrationsDeclarees: declaredReintegrations.map(toDeclaredLineDto),
      deductionsDeclarees: declaredDeductions.map(toDeclaredLineDto),
    };
    generate
      .mutateAsync(dto)
      .then((r) => setResult(r))
      .catch((err) => setError(err instanceof ApiError ? err.details : ['Le calcul a échoué.']));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wj, wg, declaredReintegrations, declaredDeductions]);

  const isLoading = fiscalYearsQuery.isLoading || ecrituresQuery.isLoading;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">
          Résultat fiscal
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Détermination du résultat fiscal (2058-A / 2058-B cadre III) — un tableau de retraitement,
          pas une écriture : rien n'est jamais écrit dans le journal.
        </p>
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Chargement…
        </div>
      ) : fiscalYears.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint">
          Aucun exercice — créez-en un dans « Exercices » pour calculer un résultat fiscal.
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
                  resetWorksheet();
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
              onClick={() => void handleInitialGenerate()}
              className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {generate.isPending && !hasGeneratedOnce ? 'Calcul…' : 'Générer'}
            </button>
          </div>

          {draftsInYear.length > 0 && (
            <div className="rounded-md bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
              {draftsInYear.length === 1
                ? '1 écriture en brouillon bloque le calcul : une écriture non validée dans ' +
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

      {result && (
        <>
          <HonestyBanner />
          <ResultatComptableSection montant={result.resultatComptable} />
          <ReintegrationsSection
            impotSurLesSocietes={result.impotSurLesSocietes}
            wj={wj}
            setWj={setWj}
            wjLigne={result.reintegrationsConfirmables.find((l) => l.code === 'WJ')}
            wg={wg}
            setWg={setWg}
            wgLigne={result.reintegrationsConfirmables.find((l) => l.code === 'WG')}
            declared={declaredReintegrations}
            setDeclared={setDeclaredReintegrations}
            total={result.totalReintegrations}
          />
          <DeductionsSection
            declared={declaredDeductions}
            setDeclared={setDeclaredDeductions}
            total={result.totalDeductions}
          />
          <ResultatFiscalTotal montant={result.resultatFiscal} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE honesty banner — the single most important element on this screen.
// Deliberately NOT styled like a "success" (green) or "error" (red) state:
// this isn't a reconciliation result, it's a permanent, structural caveat
// that applies to every résultat fiscal this module will ever produce.
// ---------------------------------------------------------------------------

function HonestyBanner() {
  return (
    <div className="rounded-lg border-2 border-warning bg-warning-soft p-5">
      <div className="text-[13px] font-bold uppercase tracking-wide text-warning">
        Ce tableau se recoupe arithmétiquement — il ne vérifie pas la complétude fiscale
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink">
        Le résultat fiscal ci-dessous est calculé correctement à partir de ce qui a été confirmé et
        déclaré (<strong>résultat fiscal = résultat comptable + Σ réintégrations − Σ déductions</strong>,
        vérifié par le serveur). Mais contrairement au bilan ou à la CA3, cette application ne peut pas
        vérifier que <strong>tous</strong> les retraitements fiscaux applicables ont été déclarés — cela
        dépend de votre jugement (ou de celui de votre expert-comptable), pas des comptes. Une
        réintégration oubliée donnera un total qui « boucle » sans être juste.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared row primitives — three visually distinct line kinds.
// ---------------------------------------------------------------------------

function Badge({ tone, children }: { tone: 'computed' | 'confirmed' | 'unconfirmed'; children: ReactNode }) {
  const toneClass =
    tone === 'computed'
      ? 'bg-bg text-ink-faint'
      : tone === 'confirmed'
        ? 'bg-positive-soft text-positive'
        : 'bg-warning-soft text-warning';
  return (
    <span className={['inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide', toneClass].join(' ')}>
      {children}
    </span>
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
// Résultat comptable — the computed anchor.
// ---------------------------------------------------------------------------

function ResultatComptableSection({ montant }: { montant: string }) {
  const isDeficit = montant.trim().startsWith('-');
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Résultat comptable"
        description="Report du compte de résultat (bénéfice WA ou perte WS) — lecture directe, non modifiable."
      />
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-2">
          <Badge tone="computed">Calculé</Badge>
          <span className="text-[13px] text-ink-muted">
            {isDeficit ? 'Perte comptable de l’exercice (WS)' : 'Bénéfice comptable de l’exercice (WA)'}
          </span>
        </div>
        <span className={['text-[18px] font-semibold tabular-nums', isDeficit ? 'text-negative' : 'text-ink'].join(' ')}>
          {formatMoneyFr(montant)}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Réintégrations (I) — I7 computed, WJ/WG confirmable, then the declared worksheet.
// ---------------------------------------------------------------------------

function ReintegrationsSection({
  impotSurLesSocietes,
  wj,
  setWj,
  wjLigne,
  wg,
  setWg,
  wgLigne,
  declared,
  setDeclared,
  total,
}: {
  impotSurLesSocietes: { code: string; label: string; montant: string };
  wj: ConfirmableState;
  setWj: (s: ConfirmableState) => void;
  wjLigne: { suggested: string; confirmed: string } | undefined;
  wg: ConfirmableState;
  setWg: (s: ConfirmableState) => void;
  wgLigne: { suggested: string; confirmed: string } | undefined;
  declared: DeclaredRow[];
  setDeclared: (rows: DeclaredRow[]) => void;
  total: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="I. Réintégrations"
        description="Comptable → fiscal : ce qui est comptabilisé en charge mais non déductible fiscalement."
      />

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            <tr className="border-b border-border">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Badge tone="computed">Calculé</Badge>
                  <span className="text-ink">Impôt sur les sociétés (I7)</span>
                </div>
                <div className="mt-0.5 pl-[3.75rem] text-[11px] text-ink-faint">
                  Compte 695 — non déductible du résultat, reporté directement du compte de résultat.
                </div>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                {formatMoneyFr(impotSurLesSocietes.montant)}
              </td>
            </tr>
            <ConfirmableRow
              code="WJ"
              label="Amendes et pénalités"
              caption="Compte 6712 — une amende mal comptabilisée ailleurs (ex. compte 6788) n'apparaîtra pas ici : vérifiez avant de confirmer."
              state={wj}
              onChange={setWj}
              suggested={wjLigne?.suggested ?? '0.00'}
            />
            <ConfirmableRow
              code="WG"
              label="Taxe sur les véhicules des sociétés"
              caption="Compte 63514."
              state={wg}
              onChange={setWg}
              suggested={wgLigne?.suggested ?? '0.00'}
            />
          </tbody>
        </table>
      </div>

      <DeclaredWorksheet
        title="Autres réintégrations déclarées"
        codes={REINTEGRATION_CODES}
        rows={declared}
        setRows={setDeclared}
        note="Provisions non déductibles (2058-B, cadre III) : utilisez le code WI ici."
      />

      <TotalRow label="= TOTAL I" montant={total} />
    </section>
  );
}

function DeductionsSection({
  declared,
  setDeclared,
  total,
}: {
  declared: DeclaredRow[];
  setDeclared: (rows: DeclaredRow[]) => void;
  total: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="II. Déductions"
        description="Fiscal → comptable : ce qui est imposable comptablement mais déductible fiscalement."
      />

      <DeclaredWorksheet
        title="Déductions déclarées"
        codes={DEDUCTION_CODES}
        rows={declared}
        setRows={setDeclared}
        note="Provisions non déductibles antérieurement taxées (2058-B, cadre III) : utilisez le code WU ici."
      />

      <div className="rounded-md bg-bg px-4 py-2.5 text-[11.5px] text-ink-faint">
        Suivi des déficits reportables (2058-B, cadre I) : non disponible dans cette version — ce
        cadre nécessite le report du déficit d'un exercice sur l'autre, un suivi pluriannuel qui
        n'est pas encore implémenté. Aucun montant de déficit reporté n'est donc pris en compte
        ci-dessous.
      </div>

      <TotalRow label="= TOTAL II" montant={total} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Résultat fiscal — the computed total.
// ---------------------------------------------------------------------------

function ResultatFiscalTotal({ montant }: { montant: string }) {
  const isDeficit = montant.trim().startsWith('-');
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-lg border border-border bg-bg p-5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            III. Résultat fiscal
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {isDeficit
              ? 'Déficit reportable en avant (XO) — résultat comptable + réintégrations − déductions'
              : 'Bénéfice (XN) — résultat comptable + réintégrations − déductions'}
          </p>
        </div>
        <span className={['text-[24px] font-semibold tabular-nums', isDeficit ? 'text-negative' : 'text-ink'].join(' ')}>
          {formatMoneyFr(montant)}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Confirmable row — the suggestion is visually inert until confirmed; only
// the confirmed value (0,00 by default) counts toward the total, and that's
// shown explicitly so the user can never mistake "found" for "counted".
// ---------------------------------------------------------------------------

function ConfirmableRow({
  code,
  label,
  caption,
  state,
  onChange,
  suggested,
}: {
  code: string;
  label: string;
  caption: string;
  state: ConfirmableState;
  onChange: (s: ConfirmableState) => void;
  suggested: string;
}) {
  const [buffer, setBuffer] = useState(() => formatMoneyFr(state.value).replace(' €', ''));

  useEffect(() => {
    setBuffer(formatMoneyFr(state.value).replace(' €', ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.confirmed]);

  function commitBuffer(raw: string) {
    const normalized = normalizeMoneyInput(raw || '0');
    const parsed = /^-?\d+(\.\d{1,2})?$/.test(normalized) ? normalized : '0.00';
    const [whole, frac = '00'] = parsed.split('.');
    const apiValue = `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`;
    onChange({ ...state, value: apiValue });
  }

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          {state.confirmed ? <Badge tone="confirmed">Confirmé</Badge> : <Badge tone="unconfirmed">À confirmer</Badge>}
          <span className="text-ink">
            {label} ({code})
          </span>
        </div>
        <div className="mt-0.5 pl-[3.75rem] text-[11px] text-ink-faint">
          Trouvé dans la comptabilité : <strong>{formatMoneyFr(suggested)}</strong>. {caption}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={buffer}
            onChange={(e) => setBuffer(sanitizeAmountBuffer(e.target.value))}
            onBlur={(e) => commitBuffer(e.target.value)}
            className="w-28 rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => onChange({ ...state, confirmed: !state.confirmed })}
            className={[
              'rounded-md px-3 py-1.5 text-[12.5px] font-medium',
              state.confirmed
                ? 'bg-bg text-ink-muted hover:bg-border-strong'
                : 'bg-accent text-white hover:bg-accent-hover',
            ].join(' ')}
          >
            {state.confirmed ? 'Modifier' : 'Confirmer'}
          </button>
        </div>
        {!state.confirmed && (
          <div className="mt-1 text-[11px] text-warning">Pas encore inclus dans le total (compte pour 0,00 €)</div>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Declared worksheet — the "à détailler sur feuillet séparé" mechanism.
// ---------------------------------------------------------------------------

function DeclaredWorksheet({
  title,
  codes,
  rows,
  setRows,
  note,
}: {
  title: string;
  codes: { code: string; label: string }[];
  rows: DeclaredRow[];
  setRows: (rows: DeclaredRow[]) => void;
  note: string;
}) {
  function addRow() {
    setRows([...rows, { id: newRowId(), code: codes[0].code, label: codes[0].label, montant: '0.00' }]);
  }

  function updateRow(id: string, patch: Partial<DeclaredRow>) {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows(rows.filter((r) => r.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[12.5px] font-semibold text-ink">{title}</h3>
        <button
          type="button"
          onClick={addRow}
          className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-hover"
        >
          + Ajouter une ligne
        </button>
      </div>
      <p className="-mt-1 text-[11px] text-ink-faint">{note}</p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-center text-[12.5px] text-ink-faint">
          Aucune ligne déclarée.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2 font-semibold">Code</th>
                <th className="px-4 py-2 font-semibold">Libellé</th>
                <th className="px-4 py-2 text-right font-semibold">Montant</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DeclaredWorksheetRow
                  key={row.id}
                  row={row}
                  codes={codes}
                  onUpdate={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeclaredWorksheetRow({
  row,
  codes,
  onUpdate,
  onRemove,
}: {
  row: DeclaredRow;
  codes: { code: string; label: string }[];
  onUpdate: (patch: Partial<DeclaredRow>) => void;
  onRemove: () => void;
}) {
  const isCustomCode = !codes.some((c) => c.code === row.code);
  const [montantBuffer, setMontantBuffer] = useState(() => formatMoneyFr(row.montant).replace(' €', ''));

  function commitMontant(raw: string) {
    const normalized = normalizeMoneyInput(raw || '0');
    const parsed = /^-?\d+(\.\d{1,2})?$/.test(normalized) ? normalized : '0.00';
    const [whole, frac = '00'] = parsed.split('.');
    onUpdate({ montant: `${whole}.${frac.padEnd(2, '0').slice(0, 2)}` });
  }

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 align-top">
        <select
          value={isCustomCode ? AUTRE_CODE : row.code}
          onChange={(e) => {
            if (e.target.value === AUTRE_CODE) {
              onUpdate({ code: '', label: '' });
            } else {
              const match = codes.find((c) => c.code === e.target.value);
              onUpdate({ code: e.target.value, label: match?.label ?? '' });
            }
          }}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
        >
          {codes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
          <option value={AUTRE_CODE}>Autre…</option>
        </select>
        {isCustomCode && (
          <input
            type="text"
            value={row.code}
            onChange={(e) => onUpdate({ code: e.target.value.toUpperCase() })}
            placeholder="Code"
            className="mt-1 w-20 rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
        )}
      </td>
      <td className="px-4 py-2 align-top">
        <input
          type="text"
          value={row.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Libellé"
          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </td>
      <td className="px-4 py-2 text-right align-top">
        <input
          type="text"
          inputMode="decimal"
          value={montantBuffer}
          onChange={(e) => setMontantBuffer(sanitizeAmountBuffer(e.target.value))}
          onBlur={(e) => commitMontant(e.target.value)}
          className="w-24 rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-[12.5px] tabular-nums text-ink outline-none focus:border-accent"
        />
      </td>
      <td className="px-4 py-2 text-right align-top">
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md px-2 py-1.5 text-[12px] font-medium text-negative hover:bg-negative-soft"
        >
          Retirer
        </button>
      </td>
    </tr>
  );
}

function TotalRow({ label, montant }: { label: string; montant: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-bg px-4 py-3">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums text-ink">{formatMoneyFr(montant)}</span>
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
