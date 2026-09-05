import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type {
  Account,
  CloudProvider,
  Ecriture,
  ExtractedInvoiceFacts,
  ProposedEcriture,
} from '../../api/types';
import type { CreateEcritureDto, CreateEcritureLigneDto, CreateTiersDto } from '../../api/dto';
import {
  useAttachDocument,
  useCloudCredentials,
  useCreateEcriture,
  useCreateTiers,
  useExtractDocument,
  useSuggestAccounts,
  useUpdateEcriture,
  useVatRates,
} from '../../api/queries';
import { ApiError } from '../../api/client';
import {
  addMoneyStrings,
  formatMoneyFr,
  isZeroMoney,
  normalizeMoneyInput,
  sanitizeAmountBuffer,
} from '../../lib/money';
import { isAuxiliaryBearingAccount, lineNeedsVatRate } from '../../lib/accounts';
import { formatVatRateOption } from '../../lib/vatRates';
import { AccountCombobox } from './AccountCombobox';
import { BalanceIndicator } from './BalanceIndicator';
import { EngineBadge } from './EngineBadge';
import { IconPaperclip } from '../layout/icons';

interface DraftLigne {
  key: string;
  compteId: string | null;
  compteAuxId: string | null;
  debit: string;
  credit: string;
  lettrage: string;
  vatRateId: string | null;
  /** ISO date string, or '' when unset — feeds the 2057 maturity split. */
  dateEcheance: string;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `l${keySeq}`;
}

/**
 * Shared by applySuggestion() (a cloud "Comptable IA" proposal) and the
 * `prefill` effect below (a recurring-entry-template application) — both
 * hand this component a CreateEcritureLigneDto-shaped line to seed a
 * fresh row from, and both need the identical mapping.
 */
function draftLigneFromProposed(l: CreateEcritureLigneDto): DraftLigne {
  return {
    key: nextKey(),
    compteId: l.compteId,
    compteAuxId: l.compteAuxId ?? null,
    debit: l.debit && !isZeroMoney(l.debit) ? l.debit.replace('.', ',') : '',
    credit: l.credit && !isZeroMoney(l.credit) ? l.credit.replace('.', ',') : '',
    lettrage: '',
    vatRateId: l.vatRateId ?? null,
    dateEcheance: l.dateEcheance ?? '',
  };
}

function emptyLigne(): DraftLigne {
  return {
    key: nextKey(),
    compteId: null,
    compteAuxId: null,
    debit: '',
    credit: '',
    lettrage: '',
    vatRateId: null,
    dateEcheance: '',
  };
}

/**
 * A due date only matters for a créance/dette line — class 4 (tiers:
 * clients, fournisseurs, personnel, état, groupe et associés, ...) or a
 * class-1 loan account (16x) — feeding 2057's Cadre A/B maturity split.
 * Shown only then, same "don't imply every line needs it" pattern as
 * lineNeedsVatRate above.
 */
function lineNeedsDueDate(account: Account | undefined): boolean {
  return Boolean(account && (account.pcgClass === 4 || account.number.startsWith('16')));
}

/**
 * InvoiceExtractionService's `dateFacture` field is captured as whatever
 * separator/order the invoice itself printed (see its own regex,
 * `\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}`) — DD/MM/YYYY is assumed here since
 * that's the only convention this app's own documents (French/Monaco
 * invoices) use elsewhere. Returns null rather than guessing on anything
 * that doesn't parse cleanly — the "Insérer" button simply does nothing
 * for a date it can't confidently convert.
 */
function toIsoFromFrenchDate(value: string): string | null {
  const match = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(value);
  if (!match) return null;
  const [, day, month, yearRaw] = match;
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function toIsoDate(value: string): string {
  return value.slice(0, 10);
}

function fromExisting(ecriture: Ecriture): DraftLigne[] {
  return ecriture.lignes.map((ligne) => ({
    key: nextKey(),
    compteId: ligne.compteId,
    compteAuxId: ligne.compteAuxId,
    debit: isZeroMoney(ligne.debit) ? '' : ligne.debit.replace('.', ','),
    credit: isZeroMoney(ligne.credit) ? '' : ligne.credit.replace('.', ','),
    lettrage: ligne.lettrage ?? '',
    vatRateId: ligne.vatRateId,
    dateEcheance: ligne.dateEcheance ? toIsoDate(ligne.dateEcheance) : '',
  }));
}

function isRowEmpty(row: DraftLigne): boolean {
  return !row.compteId && row.debit === '' && row.credit === '' && row.lettrage === '';
}

function isRowValid(row: DraftLigne, accounts: Account[]): boolean {
  if (!row.compteId) return false;
  const debit = normalizeMoneyInput(row.debit || '0');
  const credit = normalizeMoneyInput(row.credit || '0');
  const hasDebit = !isZeroMoney(debit || '0.00');
  const hasCredit = !isZeroMoney(credit || '0.00');
  if (hasDebit === hasCredit) return false;

  const mainAccount = accounts.find((a) => a.id === row.compteId);
  if (mainAccount && isAuxiliaryBearingAccount(mainAccount) && !row.compteAuxId) return false;
  return true;
}

export function EcritureEditor({
  journalId,
  fiscalYearId,
  accounts,
  existing,
  prefill,
  initialFile,
  onSaved,
  onCancel,
}: {
  journalId: string;
  fiscalYearId: string;
  accounts: Account[];
  existing: Ecriture | null;
  /**
   * Pre-fills a brand-new entry from an already-resolved,
   * UNPERSISTED CreateEcritureDto — e.g. a recurring-entry-template
   * application preview (see CLAUDE.md "Recurring entries / templates").
   * The caller is responsible for passing `journalId`/`fiscalYearId`
   * that MATCH `prefill`'s own values (this component always submits
   * using its own journalId/fiscalYearId props, never re-reads them off
   * `prefill`). Ignored when `existing` is set, same "new entries only"
   * scoping `initialFile` below already has. Every row stays freely
   * editable afterward — this only seeds the initial state.
   */
  prefill?: CreateEcritureDto;
  /**
   * Pre-seeds the attach-at-creation flow with a file the CALLER already
   * has (e.g. BatchInvoiceQueuePage.tsx, one file per queued invoice) —
   * additive only, small and optional. Runs the EXACT SAME
   * handleFileSelected() path a manual "Joindre un document" pick
   * already triggers (see the effect below), not a second code path.
   * Omitted by every other caller (e.g. JournalEntriesPage's own "+
   * Nouvelle écriture" flow) — zero behavior change there. Ignored when
   * `existing` is set, same "new entries only" scoping the rest of this
   * attach flow already has.
   */
  initialFile?: File;
  onSaved: (warnings: string[]) => void;
  onCancel: () => void;
}) {
  const [ecritureDate, setEcritureDate] = useState(
    existing
      ? toIsoDate(existing.ecritureDate)
      : (prefill?.ecritureDate ?? new Date().toISOString().slice(0, 10)),
  );
  const [pieceRef, setPieceRef] = useState(existing?.pieceRef ?? prefill?.pieceRef ?? '');
  const [libelle, setLibelle] = useState(existing?.libelle ?? prefill?.libelle ?? '');
  const [lignes, setLignes] = useState<DraftLigne[]>(
    existing
      ? fromExisting(existing)
      : (prefill?.lignes.map(draftLigneFromProposed) ?? [emptyLigne(), emptyLigne()]),
  );
  const [submitError, setSubmitError] = useState<string[] | null>(null);

  // Attach-at-creation + prefill + "Comptable IA" — see CLAUDE.md
  // "Supporting-document attachments". Scoped to NEW entries only
  // (existing === null): editing/attaching to an already-saved entry goes
  // through EcrituresList's own DocumentIndicator instead, which can
  // attach to ANY entry (draft or validated) — this editor's own attach
  // flow exists specifically to solve "before the entry has an id yet".
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [extractedFacts, setExtractedFacts] = useState<ExtractedInvoiceFacts | null>(null);
  const [comptableIA, setComptableIA] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    proposal: ProposedEcriture | null;
    message: string | null;
    provider: CloudProvider;
  } | null>(null);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  const accountInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const debitInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const createEcriture = useCreateEcriture();
  const updateEcriture = useUpdateEcriture();
  const createTiers = useCreateTiers();
  const attachDocument = useAttachDocument();
  const extractDocument = useExtractDocument();
  const suggestAccounts = useSuggestAccounts();
  const cloudCredentialsQuery = useCloudCredentials();
  const cloudProviders = (cloudCredentialsQuery.data ?? []).map((c) => c.provider);
  const vatRatesQuery = useVatRates();
  const vatRates = useMemo(
    () => [...(vatRatesQuery.data ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
    [vatRatesQuery.data],
  );
  const isSaving = createEcriture.isPending || updateEcriture.isPending;
  const readOnly = Boolean(existing?.validatedAt);

  const nonEmptyRows = useMemo(() => lignes.filter((row) => !isRowEmpty(row)), [lignes]);

  const totals = useMemo(
    () => ({
      debit: nonEmptyRows.reduce((sum, row) => addMoneyStrings(sum, row.debit || '0.00'), '0.00'),
      credit: nonEmptyRows.reduce(
        (sum, row) => addMoneyStrings(sum, row.credit || '0.00'),
        '0.00',
      ),
    }),
    [nonEmptyRows],
  );

  const balanced = totals.debit === totals.credit;
  const allRowsValid = nonEmptyRows.every((row) => isRowValid(row, accounts));
  const canSubmit =
    !readOnly &&
    nonEmptyRows.length >= 2 &&
    allRowsValid &&
    balanced &&
    !isZeroMoney(totals.debit) &&
    libelle.trim() !== '' &&
    ecritureDate !== '';

  // Named so the disabled "Enregistrer" button never leaves the user
  // guessing — the balance indicator alone only covers one of several
  // reasons the button can be disabled. Only shown once the form has
  // actually been touched, so a fresh blank entry doesn't open with a
  // wall of "required" complaints.
  const hasStarted = nonEmptyRows.length > 0 || libelle.trim() !== '' || pieceRef.trim() !== '';
  const disabledReason =
    readOnly || canSubmit || !hasStarted
      ? null
      : nonEmptyRows.length < 2
        ? 'Ajoutez au moins deux lignes (une au débit, une au crédit).'
        : !allRowsValid
          ? 'Chaque ligne doit avoir un compte, un montant au débit ou au crédit (jamais les deux), et un tiers si le compte en exige un.'
          : !balanced || isZeroMoney(totals.debit)
            ? null // the balance indicator already names this
            : libelle.trim() === ''
              ? 'Le libellé est requis.'
              : ecritureDate === ''
                ? 'La date est requise.'
                : null;

  function updateRow(index: number, patch: Partial<DraftLigne>) {
    setLignes((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    // A manual edit means the applied AI suggestion's provenance no longer
    // describes the CURRENT lines exactly — the note is about what's on
    // screen right now, not a permanent history entry.
    setSuggestionApplied(false);
  }

  function selectMainAccount(index: number, compteId: string) {
    const account = accounts.find((a) => a.id === compteId);
    const stillNeedsAux = account && isAuxiliaryBearingAccount(account);
    updateRow(index, { compteId, ...(stillNeedsAux ? {} : { compteAuxId: null }) });
  }

  function addRow(focus: boolean) {
    setLignes((rows) => [...rows, emptyLigne()]);
    if (focus) {
      requestAnimationFrame(() => {
        accountInputRefs.current[lignes.length]?.focus();
      });
    }
  }

  function removeRow(index: number) {
    if (lignes.length <= 2) return;
    setLignes((rows) => rows.filter((_, i) => i !== index));
  }

  function handleLastCellKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (index === lignes.length - 1) {
      addRow(true);
    } else {
      accountInputRefs.current[index + 1]?.focus();
    }
  }

  async function handleFileSelected(file: File) {
    setAttachedFile(file);
    setExtractedFacts(null);
    setSuggestion(null);
    setSuggestionApplied(false);
    try {
      const facts = await extractDocument.mutateAsync(file);
      setExtractedFacts(facts);
    } catch {
      // Extraction failure is non-blocking (e.g. an image with no text
      // layer, a corrupt file) — the file stays attached for the actual
      // save; there's just nothing to prefill from.
    }
  }

  // initialFile runs through the EXACT SAME handleFileSelected() path a
  // manual "Joindre un document" pick already triggers — see this prop's
  // own doc comment. Fires once per mounted instance (BatchInvoiceQueuePage
  // mounts a fresh EcritureEditor per queued file, so "once per mount" is
  // "once per file," not a re-run on every render).
  useEffect(() => {
    if (initialFile && !existing) {
      void handleFileSelected(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  async function handleSuggestAccounts(provider: CloudProvider) {
    if (!attachedFile) return;
    setSuggestion(null);
    try {
      const result = await suggestAccounts.mutateAsync({ file: attachedFile, cloudProvider: provider });
      setSuggestion({ ...result, provider });
    } catch (error) {
      setSuggestion({
        proposal: null,
        message:
          error instanceof ApiError
            ? error.details.join(' ')
            : "La suggestion a échoué — vérifiez que le fournisseur cloud est bien configuré.",
        provider,
      });
    }
  }

  function applySuggestion() {
    const proposal = suggestion?.proposal;
    if (!proposal) return;
    setLignes(proposal.dto.lignes.map(draftLigneFromProposed));
    if (proposal.dto.libelle) setLibelle(proposal.dto.libelle);
    if (proposal.dto.pieceRef) setPieceRef(proposal.dto.pieceRef);
    setSuggestionApplied(true);
  }

  async function handleSubmit() {
    setSubmitError(null);
    const lignesDto: CreateEcritureLigneDto[] = nonEmptyRows.map((row) => ({
      compteId: row.compteId!,
      compteAuxId: row.compteAuxId ?? undefined,
      debit: isZeroMoney(row.debit || '0') ? undefined : normalizeMoneyInput(row.debit),
      credit: isZeroMoney(row.credit || '0') ? undefined : normalizeMoneyInput(row.credit),
      lettrage: row.lettrage.trim() === '' ? undefined : row.lettrage.trim(),
      vatRateId: row.vatRateId ?? undefined,
      dateEcheance: row.dateEcheance === '' ? undefined : row.dateEcheance,
    }));
    const dto: CreateEcritureDto = {
      journalId,
      fiscalYearId,
      ecritureDate,
      pieceRef: pieceRef.trim() === '' ? undefined : pieceRef.trim(),
      libelle: libelle.trim(),
      lignes: lignesDto,
    };

    try {
      const result = existing
        ? await updateEcriture.mutateAsync({ id: existing.id, dto })
        : await createEcriture.mutateAsync(dto);
      const warnings = [...result.warnings];
      // Persisted only once the entry itself has a real id — see
      // handleFileSelected's own doc comment. A storage failure here must
      // never invalidate an already-correctly-saved entry: it's reported
      // as a non-blocking warning (the same banner every other compliance
      // warning already uses), never rolled back.
      if (attachedFile && !existing) {
        try {
          await attachDocument.mutateAsync({ ecritureId: result.id, file: attachedFile });
        } catch {
          warnings.push(
            "L'écriture a été enregistrée, mais le document n'a pas pu être joint — réessayez depuis la liste des écritures.",
          );
        }
      }
      onSaved(warnings);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.details : ['Une erreur est survenue.']);
    }
  }

  function handleContainerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSubmit && !isSaving) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div
      onKeyDown={handleContainerKeyDown}
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevated"
    >
      <div className="flex flex-wrap items-end gap-4 border-b border-border px-5 py-4">
        <Field label="Date">
          <input
            type="date"
            value={ecritureDate}
            disabled={readOnly}
            onChange={(e) => setEcritureDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:text-ink-faint"
          />
        </Field>
        <Field label="Référence pièce">
          <input
            type="text"
            value={pieceRef}
            disabled={readOnly}
            onChange={(e) => setPieceRef(e.target.value)}
            placeholder="FA-2026-014"
            className="w-40 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:text-ink-faint"
          />
        </Field>
        <Field label="Libellé" grow>
          <input
            type="text"
            value={libelle}
            disabled={readOnly}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Achat fournitures de bureau"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:text-ink-faint"
          />
        </Field>
        {existing && (
          <div className="ml-auto text-[12px] text-ink-faint">
            {existing.ecritureNum ? `Écriture n° ${existing.ecritureNum}` : 'Brouillon'}
          </div>
        )}
      </div>

      {!existing && (
        <div className="flex flex-col gap-3 border-b border-border bg-bg/60 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              ref={attachInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleFileSelected(file);
              }}
            />
            {attachedFile ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink">
                <IconPaperclip width={13} height={13} className="text-ink-faint" />
                {attachedFile.name}
                <button
                  type="button"
                  onClick={() => {
                    setAttachedFile(null);
                    setExtractedFacts(null);
                    setSuggestion(null);
                    setSuggestionApplied(false);
                  }}
                  aria-label="Retirer le fichier"
                  className="ml-1 text-ink-faint hover:text-negative"
                >
                  ×
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => attachInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12.5px] font-medium text-ink-muted hover:border-accent hover:text-accent"
              >
                <IconPaperclip width={13} height={13} />
                Joindre un document
              </button>
            )}
            {extractDocument.isPending && (
              <span className="text-[12px] text-ink-faint">Extraction en cours…</span>
            )}

            <span className="mx-1 h-4 w-px bg-border" />

            <button
              type="button"
              disabled={cloudProviders.length === 0}
              onClick={() => setComptableIA((v) => !v)}
              title={
                cloudProviders.length === 0
                  ? 'Configurez un fournisseur cloud pour activer la suggestion de comptes.'
                  : undefined
              }
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
                cloudProviders.length === 0
                  ? 'cursor-not-allowed bg-bg text-ink-faint'
                  : comptableIA
                    ? 'bg-warning-soft text-warning'
                    : 'border border-border text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {comptableIA && cloudProviders.length > 0 ? '☁️' : '🔒'} Comptable IA
            </button>
            {cloudProviders.length === 0 && (
              <Link
                to="/assistant/parametres"
                className="text-[12px] text-accent hover:text-accent-hover"
              >
                Configurer un fournisseur →
              </Link>
            )}

            {comptableIA && attachedFile && cloudProviders.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {cloudProviders.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    disabled={suggestAccounts.isPending}
                    onClick={() => void handleSuggestAccounts(provider)}
                    className="rounded-md border border-warning/40 bg-surface px-2.5 py-1 text-[12px] font-medium text-warning hover:bg-warning-soft disabled:opacity-50"
                  >
                    {suggestAccounts.isPending
                      ? 'Suggestion en cours…'
                      : `☁️ Suggérer les comptes avec ${provider === 'CLAUDE' ? 'Claude' : 'DeepSeek'}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {extractedFacts && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-ink-muted">
              {extractedFacts.fields.numeroFacture && (
                <span className="flex items-center gap-1">
                  N° facture : <span className="text-ink">{extractedFacts.fields.numeroFacture.value}</span>
                  <button
                    type="button"
                    onClick={() => setPieceRef(extractedFacts.fields.numeroFacture!.value)}
                    className="text-accent hover:text-accent-hover"
                  >
                    Insérer
                  </button>
                </span>
              )}
              {extractedFacts.fields.dateFacture && (
                <span className="flex items-center gap-1">
                  Date : <span className="text-ink">{extractedFacts.fields.dateFacture.value}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const iso = toIsoFromFrenchDate(extractedFacts.fields.dateFacture!.value);
                      if (iso) setEcritureDate(iso);
                    }}
                    className="text-accent hover:text-accent-hover"
                  >
                    Insérer
                  </button>
                </span>
              )}
              {(extractedFacts.fields.montantTtc ||
                extractedFacts.fields.montantHt ||
                extractedFacts.fields.montantTva) && (
                <span>
                  Facture indique :{' '}
                  {extractedFacts.fields.montantTtc && (
                    <>TTC {formatMoneyFr(extractedFacts.fields.montantTtc.value)} </>
                  )}
                  {extractedFacts.fields.montantHt && (
                    <>· HT {formatMoneyFr(extractedFacts.fields.montantHt.value)} </>
                  )}
                  {extractedFacts.fields.montantTva && (
                    <>· TVA {formatMoneyFr(extractedFacts.fields.montantTva.value)}</>
                  )}
                </span>
              )}
            </div>
          )}

          {suggestion && !suggestionApplied && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
              {suggestion.proposal ? (
                <>
                  <span>
                    Comptes suggérés par <EngineBadge engine="CLOUD" cloudProvider={suggestion.provider} /> —
                    à vérifier avant d'appliquer.
                  </span>
                  <button
                    type="button"
                    onClick={applySuggestion}
                    className="ml-auto rounded-md bg-warning px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90"
                  >
                    Appliquer la suggestion
                  </button>
                </>
              ) : (
                <span>{suggestion.message ?? "Aucune suggestion n'a été produite."}</span>
              )}
            </div>
          )}

          {suggestionApplied && suggestion?.provider && (
            <div className="flex items-center gap-2 text-[12px] text-ink-faint">
              Comptes suggérés par <EngineBadge engine="CLOUD" cloudProvider={suggestion.provider} /> —
              vérifiez avant d'enregistrer.
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="w-[26%] px-3 py-2 font-semibold">Compte</th>
              <th className="w-[16%] px-3 py-2 font-semibold">Tiers</th>
              <th className="w-[13%] px-3 py-2 text-right font-semibold">Débit</th>
              <th className="w-[13%] px-3 py-2 text-right font-semibold">Crédit</th>
              <th className="w-20 px-3 py-2 font-semibold">Lettrage</th>
              <th className="w-24 px-3 py-2 font-semibold">TVA</th>
              <th className="w-32 px-3 py-2 font-semibold">Échéance</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((row, index) => {
              const invalidBoth = !isZeroMoney(row.debit || '0') && !isZeroMoney(row.credit || '0');
              const mainAccount = accounts.find((a) => a.id === row.compteId);
              const needsAux = Boolean(mainAccount && isAuxiliaryBearingAccount(mainAccount));
              // Scoped to *this row's* collectif — a 401 line must only ever
              // offer 401 tiers, never 411 tiers picked up from another row.
              const rowAuxAccounts = mainAccount
                ? accounts.filter((a) => a.isAuxiliary && a.parentId === mainAccount.id)
                : [];
              const needsVatRate = lineNeedsVatRate(mainAccount);
              const needsDueDate = lineNeedsDueDate(mainAccount);
              return (
                <tr key={row.key} className="border-b border-border last:border-b-0 hover:bg-bg/60">
                  <td className="p-0">
                    <AccountCombobox
                      ref={(el) => {
                        accountInputRefs.current[index] = el;
                      }}
                      accounts={accounts}
                      value={row.compteId}
                      onSelect={(id) => selectMainAccount(index, id)}
                      onNavigateNext={() => debitInputRefs.current[index]?.focus()}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="p-0">
                    {needsAux ? (
                      <AccountCombobox
                        accounts={rowAuxAccounts}
                        value={row.compteAuxId}
                        onSelect={(id) => updateRow(index, { compteAuxId: id })}
                        placeholder="N° tiers"
                        disabled={readOnly}
                        createLabel="nouveau tiers"
                        onCreateNew={
                          mainAccount
                            ? (label) =>
                                createTiers.mutateAsync({
                                  parentId: mainAccount.id,
                                  dto: { label } satisfies CreateTiersDto,
                                })
                            : undefined
                        }
                      />
                    ) : (
                      <span className="block px-2 py-1.5 text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="p-0">
                    <input
                      ref={(el) => {
                        debitInputRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="decimal"
                      disabled={readOnly}
                      value={row.debit}
                      onChange={(e) =>
                        updateRow(index, { debit: sanitizeAmountBuffer(e.target.value) })
                      }
                      onKeyDown={(e) => handleLastCellKeyDown(e, index)}
                      placeholder="0,00"
                      className={[
                        'w-full bg-transparent px-3 py-1.5 text-right tabular-nums text-ink outline-none placeholder:text-ink-faint disabled:text-ink-faint',
                        invalidBoth ? 'text-negative' : '',
                      ].join(' ')}
                    />
                  </td>
                  <td className="p-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={readOnly}
                      value={row.credit}
                      onChange={(e) =>
                        updateRow(index, { credit: sanitizeAmountBuffer(e.target.value) })
                      }
                      onKeyDown={(e) => handleLastCellKeyDown(e, index)}
                      placeholder="0,00"
                      className={[
                        'w-full bg-transparent px-3 py-1.5 text-right tabular-nums text-ink outline-none placeholder:text-ink-faint disabled:text-ink-faint',
                        invalidBoth ? 'text-negative' : '',
                      ].join(' ')}
                    />
                  </td>
                  <td className="p-0">
                    <input
                      type="text"
                      disabled={readOnly}
                      value={row.lettrage}
                      onChange={(e) => updateRow(index, { lettrage: e.target.value })}
                      onKeyDown={(e) => handleLastCellKeyDown(e, index)}
                      placeholder="—"
                      className="w-full bg-transparent px-3 py-1.5 text-ink outline-none placeholder:text-ink-faint disabled:text-ink-faint"
                    />
                  </td>
                  <td className="p-0">
                    {needsVatRate ? (
                      <select
                        disabled={readOnly}
                        value={row.vatRateId ?? ''}
                        onChange={(e) =>
                          updateRow(index, { vatRateId: e.target.value === '' ? null : e.target.value })
                        }
                        className="w-full bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none disabled:text-ink-faint"
                      >
                        <option value="">—</option>
                        {vatRates.map((rate) => (
                          <option key={rate.id} value={rate.id}>
                            {formatVatRateOption(rate)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="block px-2 py-1.5 text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="p-0">
                    {needsDueDate ? (
                      <input
                        type="date"
                        disabled={readOnly}
                        value={row.dateEcheance}
                        onChange={(e) => updateRow(index, { dateEcheance: e.target.value })}
                        className="w-full bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none disabled:text-ink-faint"
                      />
                    ) : (
                      <span className="block px-2 py-1.5 text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-1 text-center">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        disabled={lignes.length <= 2}
                        aria-label="Supprimer la ligne"
                        className="rounded p-1 text-ink-faint hover:bg-negative-soft hover:text-negative disabled:cursor-not-allowed disabled:opacity-0"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <path
                            d="M3 3.5h8M5.5 3.5v-1h3v1M4.5 3.5 5 11h4l.5-7.5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!readOnly && (
          <button
            type="button"
            onClick={() => addRow(true)}
            className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-left text-[12.5px] font-medium text-ink-muted hover:bg-bg hover:text-accent"
          >
            <span className="text-[15px] leading-none">+</span> Ajouter une ligne
          </button>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-4 border-t border-border bg-surface px-5 py-3.5">
        <div className="flex items-center gap-5 text-[13px] tabular-nums text-ink-muted">
          <span>
            Débit <span className="font-semibold text-ink">{formatMoneyFr(totals.debit)}</span>
          </span>
          <span>
            Crédit <span className="font-semibold text-ink">{formatMoneyFr(totals.credit)}</span>
          </span>
        </div>
        <BalanceIndicator totalDebit={totals.debit} totalCredit={totals.credit} />
        {disabledReason && (
          <span className="text-[12px] text-ink-faint">{disabledReason}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
          >
            Annuler
          </button>
          {!readOnly && (
            <button
              type="button"
              disabled={!canSubmit || isSaving}
              onClick={handleSubmit}
              title="Ctrl/Cmd + Entrée"
              className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {isSaving ? 'Enregistrement…' : 'Enregistrer le brouillon'}
            </button>
          )}
        </div>
      </div>

      {submitError && (
        <div className="border-t border-negative-soft bg-negative-soft px-5 py-3 text-[12.5px] text-negative">
          {submitError.map((message, i) => (
            <div key={i}>{message}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  grow,
}: {
  label: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <label className={grow ? 'flex flex-1 flex-col gap-1' : 'flex flex-col gap-1'}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
