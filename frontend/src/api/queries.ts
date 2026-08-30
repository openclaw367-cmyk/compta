import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { downloadBlob } from '../lib/download';
import type {
  Account,
  AccountLedgerResponse,
  BankAccount,
  BankAggregatorLinkSummary,
  BankStatementImport,
  BankStatementLine,
  Ca3Declaration,
  Ca3LineTraceResult,
  Ca3TraceColumn,
  CashFlowStatement,
  CessionResult,
  ChatMessage,
  ChatSession,
  ChatSessionWithMessages,
  CloudCredentialSummary,
  CloudProvider,
  Company,
  DashboardSummary,
  DepreciationEntry,
  DocumentAccountSuggestion,
  Ecriture,
  EcritureDocument,
  EcritureDocumentAuditEntry,
  EcritureWriteResult,
  ExtractedInvoiceFacts,
  FinancialAnalysisResult,
  FiscalYear,
  FixedAsset,
  ImportBatch,
  ImportPreviewResponse,
  FinalizeInvoiceResult,
  Invoice,
  InvoiceMentions,
  Journal,
  LiasseAnyResult,
  LineTraceResult,
  LocalModelAvailability,
  Regime,
  ResultatFiscalLineTraceResult,
  ResultatFiscalResult,
  ResultatFiscalTraceCode,
  Tableau2054TraceColumn,
  Tableau2054TraceResult,
  Tableau2055TraceColumn,
  Tableau2055TraceResult,
  Tableau2056TraceColumn,
  Tableau2056TraceResult,
  Tableau2059TraceColumn,
  Tableau2059TraceResult,
  StatementLineMatchProposal,
  StatementPreviewResponse,
  TrialBalanceResponse,
  VatRate,
} from './types';
import type {
  CessionFixedAssetDto,
  ComputeResultatFiscalDto,
  CreateAccountDto,
  CreateBankAccountDto,
  CreateCompanyDto,
  CreateEcritureDto,
  CreateFiscalYearDto,
  CreateFixedAssetDto,
  CreateInvoiceDto,
  CreateJournalDto,
  CreateTiersDto,
  CreateVatRateDto,
  DevisRequestDto,
  FinalizeInvoiceDto,
  SendChatMessageDto,
  SetCloudCredentialDto,
  UpdateAccountDto,
  UpdateCompanyDto,
} from './dto';

/**
 * GET /entries has no server-side journal/fiscal-year filter (it's a
 * single-company MVP over a small dataset) — the journal grid filters
 * client-side. See CLAUDE.md if that dataset assumption ever stops
 * holding.
 */

interface PeriodParams {
  fiscalYearId: string | null;
  periodStart?: string;
  periodEnd?: string;
}

function periodQueryString({ fiscalYearId, periodStart, periodEnd }: PeriodParams): string {
  const entries = Object.entries({ fiscalYearId, periodStart, periodEnd }).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );
  return entries.length === 0
    ? ''
    : '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** Invalidated by every mutation that can move the ledger, so Grand livre never shows stale data. */
function invalidateEcrituresAndLedger(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['ecritures'] });
  void queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
  void queryClient.invalidateQueries({ queryKey: ['account-ledger'] });
}

export function useJournals() {
  return useQuery({
    queryKey: ['journals'],
    queryFn: () => api.get<Journal[]>('/journals'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateJournal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateJournalDto) => api.post<Journal>('/journals', dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['journals'] });
    },
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<Account[]>('/accounts'),
    staleTime: 5 * 60 * 1000,
  });
}

/** A plain PCG account (never a tiers) — see useCreateTiers for comptes auxiliaires. */
export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateAccountDto) => api.post<Account>('/accounts', dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useFiscalYears() {
  return useQuery({
    queryKey: ['fiscal-years'],
    queryFn: () => api.get<FiscalYear[]>('/fiscal-years'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useVatRates() {
  return useQuery({
    queryKey: ['vat-rates'],
    queryFn: () => api.get<VatRate[]>('/vat/rates'),
  });
}

export function useCreateVatRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateVatRateDto) => api.post<VatRate>('/vat/rates', dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vat-rates'] });
    },
  });
}

/**
 * Computes a CA3 declaration for a period — read-only, never writes to
 * the ledger. See VatService.computeDeclaration on the backend: refuses
 * (409) if any écriture dated in the period is still a draft, and throws
 * (400) on an untagged/unmapped-rate collectée line, an unmapped 4456x
 * account, or a negative bucket — the page surfaces those messages as-is
 * rather than showing a blank result.
 */
export function useComputeVatDeclaration() {
  return useMutation({
    mutationFn: (params: { periodStart: string; periodEnd: string }) =>
      api.post<Ca3Declaration>('/vat/declaration', params),
  });
}

/**
 * Generates the liasse fiscale for a fiscal year — read-only, never
 * writes to the ledger. See LiasseService.generate on the backend:
 * branches on Company.regime (REEL_NORMAL → full 2050-series,
 * REEL_SIMPLIFIE → 2033-A/2033-B), refuses (409) if any écriture in the
 * fiscal year is still a draft, and refuses (400/409) on an unmapped
 * account, a sign ambiguity, or a bilan that doesn't balance — the page
 * surfaces those messages as-is.
 */
export function useGenerateLiasse() {
  return useMutation({
    mutationFn: (params: { fiscalYearId: string }) =>
      api.post<LiasseAnyResult>('/liasse/generate', params),
  });
}

/**
 * Generates the OTHER regime's liasse — a comparison view, from the
 * exact same ledger, independent of Company.regime. See
 * LiasseService.generateSecondary: a separate endpoint/mutation on
 * purpose, so a failure computing the comparison regime never blocks
 * the primary useGenerateLiasse() result — the two calls are
 * independent, not chained through shared error state.
 */
export function useGenerateLiasseSecondary() {
  return useMutation({
    mutationFn: (params: { fiscalYearId: string }) =>
      api.post<LiasseAnyResult>('/liasse/generate-secondary', params),
  });
}

/**
 * Generates the tableau des flux de trésorerie (méthode indirecte) for a
 * fiscal year — read-only, never writes to the ledger. See
 * CashFlowService.generate on the backend: refuses (409) if any écriture
 * in the fiscal year is still a draft, or if the three flux sections
 * don't reconcile to the actual change in trésorerie — a successful
 * response here is already reconciled, never a mismatch silently shown.
 */
export function useGenerateCashFlow() {
  return useMutation({
    mutationFn: (params: { fiscalYearId: string }) =>
      api.post<CashFlowStatement>('/cash-flow/generate', params),
  });
}

/**
 * Computes the retraitement analytique (SIG, BFR/FR/trésorerie, ratios) for
 * a fiscal year — read-only, never writes to the ledger. See
 * FinancialAnalysisService.generate on the backend: refuses (409) if any
 * écriture in the fiscal year is still a draft, or if BFR/trésorerie nette
 * fail to reconcile — a successful response here is already reconciled.
 */
export function useGenerateFinancialAnalysis() {
  return useMutation({
    mutationFn: (params: { fiscalYearId: string }) =>
      api.post<FinancialAnalysisResult>('/financial-analysis/generate', params),
  });
}

/**
 * Computes the détermination du résultat fiscal (2058-A/2058-B cadre III)
 * for a fiscal year — read-only, never writes to the ledger. See
 * ResultatFiscalService.generate on the backend: refuses (409) if any
 * écriture in the fiscal year is still a draft. Unlike every other
 * "generate" endpoint in this app, a successful response here proves the
 * worksheet's own ARITHMETIC, never tax completeness — see
 * ResultatFiscalPage's prominent banner.
 */
export function useGenerateResultatFiscal() {
  return useMutation({
    mutationFn: (dto: ComputeResultatFiscalDto) =>
      api.post<ResultatFiscalResult>('/resultat-fiscal/generate', dto),
  });
}

export function useCompany() {
  return useQuery({
    queryKey: ['company'],
    queryFn: () => api.get<Company>('/companies/current'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCompanyDto) => api.patch<Company>('/companies/current', dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['company'] });
    },
  });
}

/**
 * Creates a new tenant, scaffolded (chart of accounts + journals) by
 * CompaniesService.create() — see that method's own doc comment. Not
 * scoped to the current company (this is how a NEW one comes into
 * existence); invalidates the picker's own list
 * (AppProvider.tsx's `['app-companies']` query) so the new company shows
 * up there immediately, same as any other write invalidating its list.
 */
export function useCreateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCompanyDto) => api.post<Company>('/companies', dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app-companies'] });
    },
  });
}

export function useCreateFiscalYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateFiscalYearDto) => api.post<FiscalYear>('/fiscal-years', dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fiscal-years'] });
    },
  });
}

/** Refuses (ConflictException) while the year still has draft écritures — see fiscal-years.service.ts. */
export function useCloseFiscalYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<FiscalYear>(`/fiscal-years/${id}/close`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fiscal-years'] });
    },
  });
}

/**
 * Posts and immediately validates the à-nouveau écriture for a fiscal year,
 * carrying forward its closed predecessor's balance-sheet balances (classes
 * 1-5) and folding the predecessor's result into 120/129 — see
 * ANouveauService.generate on the backend for the full carry rules. Refuses
 * (with a clear message) if the predecessor isn't closed, doesn't exist, or
 * à-nouveau entries were already generated for this year.
 */
export function useGenerateANouveau() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fiscalYearId: string) =>
      api.post<Ecriture>(`/fiscal-years/${fiscalYearId}/a-nouveau`, {}),
    onSuccess: () => invalidateEcrituresAndLedger(queryClient),
  });
}

export function useEcritures() {
  return useQuery({
    queryKey: ['ecritures'],
    queryFn: () => api.get<Ecriture[]>('/entries'),
  });
}

export function useCreateEcriture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateEcritureDto) => api.post<EcritureWriteResult>('/entries', dto),
    onSuccess: () => invalidateEcrituresAndLedger(queryClient),
  });
}

export function useUpdateEcriture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: CreateEcritureDto }) =>
      api.patch<EcritureWriteResult>(`/entries/${id}`, dto),
    onSuccess: () => invalidateEcrituresAndLedger(queryClient),
  });
}

export function useDeleteEcriture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/entries/${id}`),
    onSuccess: () => invalidateEcrituresAndLedger(queryClient),
  });
}

/** Locks the écriture and assigns its EcritureNum — draft and validate stay distinct steps. */
export function useValidateEcriture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Ecriture>(`/entries/${id}/validate`, {}),
    onSuccess: () => invalidateEcrituresAndLedger(queryClient),
  });
}

/**
 * Creates a new draft écriture with debit/credit swapped, referencing the
 * original via reversesId (contre-passation / extourne) — the only legal
 * way to correct a validated entry. The original itself is never touched;
 * the reversal comes back as a fresh draft, to be reviewed and validated
 * like any other.
 */
export function useReverseEcriture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Ecriture>(`/entries/${id}/reverse`, {}),
    onSuccess: () => invalidateEcrituresAndLedger(queryClient),
  });
}

/**
 * Supporting-document attachments — see CLAUDE.md "Supporting-document
 * attachments". Allowed regardless of the entry's validated/draft status
 * (the backend never gates on it); every mutation invalidates ['ecritures']
 * so EcrituresList's paperclip/count indicator stays in sync, plus this
 * entry's own documents/audit-log queries.
 */
export function useEcritureDocuments(ecritureId: string | null) {
  return useQuery({
    queryKey: ['ecriture-documents', ecritureId],
    queryFn: () => api.get<EcritureDocument[]>(`/entries/${ecritureId}/documents`),
    enabled: Boolean(ecritureId),
  });
}

export function useEcritureDocumentAuditLog(ecritureId: string | null) {
  return useQuery({
    queryKey: ['ecriture-document-audit-log', ecritureId],
    queryFn: () =>
      api.get<EcritureDocumentAuditEntry[]>(`/entries/${ecritureId}/documents/audit-log`),
    enabled: Boolean(ecritureId),
  });
}

function invalidateDocuments(
  queryClient: ReturnType<typeof useQueryClient>,
  ecritureId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ['ecritures'] });
  void queryClient.invalidateQueries({ queryKey: ['ecriture-documents', ecritureId] });
  void queryClient.invalidateQueries({ queryKey: ['ecriture-document-audit-log', ecritureId] });
}

export function useAttachDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ecritureId, file }: { ecritureId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.postForm<EcritureDocument>(`/entries/${ecritureId}/documents`, formData);
    },
    onSuccess: (_data, { ecritureId }) => invalidateDocuments(queryClient, ecritureId),
  });
}

export function useReplaceDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ecritureId,
      documentId,
      file,
    }: {
      ecritureId: string;
      documentId: string;
      file: File;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.putForm<EcritureDocument>(
        `/entries/${ecritureId}/documents/${documentId}`,
        formData,
      );
    },
    onSuccess: (_data, { ecritureId }) => invalidateDocuments(queryClient, ecritureId),
  });
}

export function useRemoveDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ecritureId, documentId }: { ecritureId: string; documentId: string }) =>
      api.delete<void>(`/entries/${ecritureId}/documents/${documentId}`),
    onSuccess: (_data, { ecritureId }) => invalidateDocuments(queryClient, ecritureId),
  });
}

/**
 * Deterministic extraction, no persistence, no écriture id required — see
 * CLAUDE.md "Supporting-document attachments" — Layer 2. What makes
 * attaching a file WHILE creating a new draft (before it has an id) work.
 */
export function useExtractDocument() {
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.postForm<ExtractedInvoiceFacts>('/documents/extract', formData);
    },
  });
}

/**
 * The "Comptable IA" toggle's explicit action (see CLAUDE.md "Supporting-
 * document attachments" — Layer 3) — one cloud turn, gated on a configured
 * credential, reusing propose_ecriture's own review discipline. Never
 * invalidates anything itself: the suggestion only merges into
 * EcritureEditor's own draft state on confirm, it never writes.
 */
export function useSuggestAccounts() {
  return useMutation({
    mutationFn: ({ file, cloudProvider }: { file: File; cloudProvider: CloudProvider }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('cloudProvider', cloudProvider);
      return api.postForm<DocumentAccountSuggestion>('/documents/suggest-accounts', formData);
    },
  });
}

/**
 * Trial balance (balance générale). Includes draft écritures as well as
 * validated ones — see LedgerService.trialBalance on the backend; this is
 * a working balance for day-to-day use, not FEC export's validated-only
 * compliance view.
 */
export function useTrialBalance(params: PeriodParams) {
  return useQuery({
    queryKey: ['trial-balance', params.fiscalYearId, params.periodStart, params.periodEnd],
    queryFn: () =>
      api.get<TrialBalanceResponse>(`/ledger/trial-balance${periodQueryString(params)}`),
    enabled: Boolean(params.fiscalYearId),
  });
}

/** One account's grand livre (line-by-line detail with a running balance). */
export function useAccountLedger(accountId: string | null, params: PeriodParams) {
  return useQuery({
    queryKey: [
      'account-ledger',
      accountId,
      params.fiscalYearId,
      params.periodStart,
      params.periodEnd,
    ],
    queryFn: () =>
      api.get<AccountLedgerResponse>(
        `/ledger/accounts/${accountId}${periodQueryString(params)}`,
      ),
    enabled: Boolean(accountId && params.fiscalYearId),
  });
}

/**
 * Traceability drill-down, Tier 1 — see CLAUDE.md "Traceability
 * drill-down". A genuine read (GET, auto-fetched when a report row is
 * expanded — not a triggered "Générer" action), same discipline as
 * every other real read in this file. `enabled` requires both a fiscal
 * year AND a line code so a collapsed row never fires a request.
 */
/**
 * `regime` is REQUIRED and must be the regime of the SECTION being traced,
 * not necessarily the company's own official regime — the comparison view
 * (see ComparisonSection in LiassePage.tsx) renders the OTHER regime's
 * bilan/CDR alongside the official one, so a click there must pass THAT
 * regime. The backend branches on this param explicitly, never re-deriving
 * it from Company.regime — see LineTraceQueryDto's own doc comment for the
 * bug this fixes.
 */
export function useTraceBilanLine(
  fiscalYearId: string | null,
  lineCode: string | null,
  regime: Regime | null,
) {
  return useQuery({
    queryKey: ['liasse-bilan-line-trace', fiscalYearId, lineCode, regime],
    queryFn: () =>
      api.get<LineTraceResult>(
        `/liasse/bilan-line-trace?fiscalYearId=${encodeURIComponent(fiscalYearId!)}&lineCode=${encodeURIComponent(lineCode!)}&regime=${encodeURIComponent(regime!)}`,
      ),
    enabled: Boolean(fiscalYearId && lineCode && regime),
  });
}

export function useTraceCdrLine(
  fiscalYearId: string | null,
  lineCode: string | null,
  regime: Regime | null,
) {
  return useQuery({
    queryKey: ['liasse-cdr-line-trace', fiscalYearId, lineCode, regime],
    queryFn: () =>
      api.get<LineTraceResult>(
        `/liasse/cdr-line-trace?fiscalYearId=${encodeURIComponent(fiscalYearId!)}&lineCode=${encodeURIComponent(lineCode!)}&regime=${encodeURIComponent(regime!)}`,
      ),
    enabled: Boolean(fiscalYearId && lineCode && regime),
  });
}

/**
 * Traceability drill-down, Tier 2 — 2054/2055/2056. See CLAUDE.md
 * "Traceability drill-down". Same GET/auto-fetched discipline as Tier
 * 1's own hooks above, REEL_NORMAL only (no regime param — these
 * annexes have no 2033-series equivalent to disambiguate).
 */
export function useTraceTableau2054(
  fiscalYearId: string | null,
  rowCode: string | null,
  column: Tableau2054TraceColumn | null,
) {
  return useQuery({
    queryKey: ['liasse-tableau-2054-trace', fiscalYearId, rowCode, column],
    queryFn: () =>
      api.get<Tableau2054TraceResult>(
        `/liasse/tableau-2054-trace?fiscalYearId=${encodeURIComponent(fiscalYearId!)}&rowCode=${encodeURIComponent(rowCode!)}&column=${encodeURIComponent(column!)}`,
      ),
    enabled: Boolean(fiscalYearId && rowCode && column),
  });
}

export function useTraceTableau2055(
  fiscalYearId: string | null,
  categoryCode: string | null,
  column: Tableau2055TraceColumn | null,
) {
  return useQuery({
    queryKey: ['liasse-tableau-2055-trace', fiscalYearId, categoryCode, column],
    queryFn: () =>
      api.get<Tableau2055TraceResult>(
        `/liasse/tableau-2055-trace?fiscalYearId=${encodeURIComponent(fiscalYearId!)}&categoryCode=${encodeURIComponent(categoryCode!)}&column=${encodeURIComponent(column!)}`,
      ),
    enabled: Boolean(fiscalYearId && categoryCode && column),
  });
}

export function useTraceTableau2056(
  fiscalYearId: string | null,
  categoryCode: string | null,
  column: Tableau2056TraceColumn | null,
) {
  return useQuery({
    queryKey: ['liasse-tableau-2056-trace', fiscalYearId, categoryCode, column],
    queryFn: () =>
      api.get<Tableau2056TraceResult>(
        `/liasse/tableau-2056-trace?fiscalYearId=${encodeURIComponent(fiscalYearId!)}&categoryCode=${encodeURIComponent(categoryCode!)}&column=${encodeURIComponent(column!)}`,
      ),
    enabled: Boolean(fiscalYearId && categoryCode && column),
  });
}

/**
 * Traceability drill-down, Tier 3 — 2059-A. Keyed by assetId, not
 * category+column, since a 2059-A row is already asset-level.
 */
export function useTraceTableau2059(
  fiscalYearId: string | null,
  assetId: string | null,
  column: Tableau2059TraceColumn | null,
) {
  return useQuery({
    queryKey: ['liasse-tableau-2059-trace', fiscalYearId, assetId, column],
    queryFn: () =>
      api.get<Tableau2059TraceResult>(
        `/liasse/tableau-2059-trace?fiscalYearId=${encodeURIComponent(fiscalYearId!)}&assetId=${encodeURIComponent(assetId!)}&column=${encodeURIComponent(column!)}`,
      ),
    enabled: Boolean(fiscalYearId && assetId && column),
  });
}

/**
 * Traceability drill-down, Tier 3 — CA3 lignes 08/09/9B/T6. Period-
 * scoped (not fiscal-year-scoped) since it mirrors /vat/declaration's
 * own period params — no "→ écritures" hop, see ca3-line-trace.ts's
 * own doc comment for why.
 */
export function useTraceCa3Line(
  periodStart: string | null,
  periodEnd: string | null,
  ligne: string | null,
  column: Ca3TraceColumn | null,
) {
  return useQuery({
    queryKey: ['ca3-line-trace', periodStart, periodEnd, ligne, column],
    queryFn: () =>
      api.get<Ca3LineTraceResult>(
        `/vat/declaration/ca3-line-trace?periodStart=${encodeURIComponent(periodStart!)}&periodEnd=${encodeURIComponent(periodEnd!)}&ligne=${encodeURIComponent(ligne!)}&column=${encodeURIComponent(column!)}`,
      ),
    enabled: Boolean(periodStart && periodEnd && ligne && column),
  });
}

/**
 * Traceability drill-down, Tier 3 — 2058 WJ/WG (the ledger-suggested
 * réintégrations). Traces the SUGGESTION only — a manually-confirmed
 * override has no ledger backing to trace.
 */
export function useTraceResultatFiscalLine(
  fiscalYearId: string | null,
  code: ResultatFiscalTraceCode | null,
) {
  return useQuery({
    queryKey: ['resultat-fiscal-trace', fiscalYearId, code],
    queryFn: () =>
      api.get<ResultatFiscalLineTraceResult>(
        `/resultat-fiscal/trace?fiscalYearId=${encodeURIComponent(fiscalYearId!)}&code=${encodeURIComponent(code!)}`,
      ),
    enabled: Boolean(fiscalYearId && code),
  });
}

/**
 * Tiers (comptes auxiliaires) are Accounts — there's no separate query key
 * for them. GET /accounts already returns every account for the company
 * (tiers included), so both the journal grid's CompAux picker and the
 * tiers-management screen just filter the same ['accounts'] cache by
 * isAuxiliary/parentId; these mutations invalidate that one key so both
 * stay in sync automatically.
 */
export function useCreateTiers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, dto }: { parentId: string; dto: CreateTiersDto }) =>
      api.post<Account>(`/accounts/${parentId}/tiers`, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useRenameAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateAccountDto }) =>
      api.patch<Account>(`/accounts/${id}`, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

function importFormData(fiscalYearId: string, file: File): FormData {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('fiscalYearId', fiscalYearId);
  return formData;
}

/** Pure read — writes nothing server-side, safe to call as often as needed. */
export function usePreviewImport() {
  return useMutation({
    mutationFn: ({ fiscalYearId, file }: { fiscalYearId: string; file: File }) =>
      api.postForm<ImportPreviewResponse>(
        '/import-excel/preview',
        importFormData(fiscalYearId, file),
      ),
  });
}

/** The real commit — re-submits the same file previewed a moment earlier. */
export function useConfirmImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fiscalYearId, file }: { fiscalYearId: string; file: File }) =>
      api.postForm<ImportBatch>('/import-excel', importFormData(fiscalYearId, file)),
    onSuccess: () => invalidateEcrituresAndLedger(queryClient),
  });
}

/** Fails loudly (see backend) if any écriture in the fiscal year is still a draft, or the company has no SIREN. */
export function useDownloadFec() {
  return useMutation({
    mutationFn: (fiscalYearId: string) =>
      api.getFile(`/fec/export?fiscalYearId=${encodeURIComponent(fiscalYearId)}`),
  });
}

/** The descriptif required alongside the FEC file by Article A47 A-1 §XI. */
export function useDownloadFecDescription() {
  return useMutation({
    mutationFn: (fiscalYearId: string) =>
      api.getFile(`/fec/export/description?fiscalYearId=${encodeURIComponent(fiscalYearId)}`),
  });
}

/** List view: every asset with valeurBrute/amortissementsCumules/vnc already computed. */
export function useFixedAssets() {
  return useQuery({
    queryKey: ['fixed-assets'],
    queryFn: () => api.get<FixedAsset[]>('/depreciation/fixed-assets'),
  });
}

/** Single-asset counterpart of useFixedAssets, same enriched shape. */
export function useFixedAsset(id: string | null) {
  return useQuery({
    queryKey: ['fixed-assets', id],
    queryFn: () => api.get<FixedAsset>(`/depreciation/fixed-assets/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateFixedAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateFixedAssetDto) => api.post<FixedAsset>('/depreciation/fixed-assets', dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
    },
  });
}

/** Read-only: the asset's already-computed plan d'amortissement (never regenerates it). */
export function useSchedule(fixedAssetId: string | null) {
  return useQuery({
    queryKey: ['fixed-asset-schedule', fixedAssetId],
    queryFn: () => api.get<DepreciationEntry[]>(`/depreciation/fixed-assets/${fixedAssetId}/schedule`),
    enabled: Boolean(fixedAssetId),
  });
}

/** Computes and persists the straight-line schedule — safe to call again (no-ops on posted lines, throws on a genuine mismatch). */
export function useGenerateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fixedAssetId: string) =>
      api.post<DepreciationEntry[]>(`/depreciation/fixed-assets/${fixedAssetId}/schedule`, {}),
    onSuccess: (_data, fixedAssetId) => {
      void queryClient.invalidateQueries({ queryKey: ['fixed-asset-schedule', fixedAssetId] });
    },
  });
}

/**
 * Posts one period's dotation as a real, validated écriture (débit expense
 * / crédit amortissements) through the normal entries validation layer —
 * see DepreciationService.postDotation on the backend. Invalidates the
 * schedule, the asset list (VNC changes), and the ledger/ecritures caches
 * since a real écriture now exists.
 */
export function usePostDotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (depreciationEntryId: string) =>
      api.post<DepreciationEntry>(`/depreciation/fixed-assets/entries/${depreciationEntryId}/post`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fixed-asset-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
      invalidateEcrituresAndLedger(queryClient);
    },
  });
}

/**
 * Disposes of (céder) a fixed asset — posts the prorated final dotation
 * (if needed) and the disposal écriture itself, both real and validated,
 * through DepreciationService.disposeFixedAsset on the backend. Same
 * invalidation footprint as usePostDotation: schedule, asset list (VNC/
 * cessionDate change), and the ledger/ecritures caches since real
 * écritures now exist.
 */
export function useDisposeFixedAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fixedAssetId, dto }: { fixedAssetId: string; dto: CessionFixedAssetDto }) =>
      api.post<CessionResult>(`/depreciation/fixed-assets/${fixedAssetId}/cession`, dto),
    onSuccess: (_data, { fixedAssetId }) => {
      void queryClient.invalidateQueries({ queryKey: ['fixed-asset-schedule', fixedAssetId] });
      void queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
      invalidateEcrituresAndLedger(queryClient);
    },
  });
}

/**
 * AI chatbot (Phase 1) — see CLAUDE.md "AI chatbot". Polled on an interval
 * (not just on mount) so the degraded-state banner in AssistantPage
 * clears itself automatically once a local model comes up, without the
 * user needing to reload.
 */
export function useLocalModelAvailability() {
  return useQuery({
    queryKey: ['ai-chat-availability'],
    queryFn: () => api.get<LocalModelAvailability>('/ai-chat/availability'),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
}

export function useChatSessions() {
  return useQuery({
    queryKey: ['ai-chat-sessions'],
    queryFn: () => api.get<ChatSession[]>('/ai-chat/sessions'),
  });
}

export function useCreateChatSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ChatSession>('/ai-chat/sessions', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    },
  });
}

export function useChatSession(id: string | null) {
  return useQuery({
    queryKey: ['ai-chat-session', id],
    queryFn: () => api.get<ChatSessionWithMessages>(`/ai-chat/sessions/${id}`),
    enabled: id !== null,
  });
}

/**
 * Sends one message and runs the read-tool-calling loop — can take a
 * while on real hardware (observed live: single-digit seconds to ~2
 * minutes depending on the tool called and the model's own load state),
 * never a quick round-trip like the rest of this app's mutations. The
 * caller must show a clear "thinking" state, not assume this resolves
 * quickly.
 */
/**
 * Attached files (PDF/Excel invoices) go through `postForm` as
 * multipart/form-data — the backend parses them deterministically before
 * the model ever runs (see CLAUDE.md "AI chatbot Phase 2 — invoice
 * extraction"). Only the user's own files, attached to this exact
 * request, are ever read — never a filesystem path.
 */
export function useSendChatMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      dto,
      files,
    }: {
      sessionId: string;
      dto: SendChatMessageDto;
      files?: File[];
    }) => {
      if (!files || files.length === 0) {
        return api.post<ChatMessage[]>(`/ai-chat/sessions/${sessionId}/messages`, dto);
      }
      const formData = new FormData();
      formData.append('content', dto.content);
      if (dto.cloudProvider) {
        formData.append('cloudProvider', dto.cloudProvider);
      }
      for (const file of files) {
        formData.append('files', file);
      }
      return api.postForm<ChatMessage[]>(`/ai-chat/sessions/${sessionId}/messages`, formData);
    },
    onSuccess: (_data, { sessionId }) => {
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    },
  });
}

/**
 * The explicit "Revenir au local" action (see CLAUDE.md "AI chatbot cloud
 * tier") — closes any open cloud-proposal thread on a session. Safe to
 * call even when none is open.
 */
export function useCloseCloudThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<ChatSession>(`/ai-chat/sessions/${sessionId}/cloud-thread/close`, {}),
    onSuccess: (_data, sessionId) => {
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    },
  });
}

/**
 * AI chatbot cloud tier (see CLAUDE.md "AI chatbot cloud tier") — every
 * response here is a masked summary, never the real key; the backend has
 * no endpoint that returns plaintext at all.
 */
export function useCloudCredentials() {
  return useQuery({
    queryKey: ['ai-chat-cloud-credentials'],
    queryFn: () => api.get<CloudCredentialSummary[]>('/ai-chat/cloud-credentials'),
  });
}

export function useSetCloudCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SetCloudCredentialDto) =>
      api.post<CloudCredentialSummary>('/ai-chat/cloud-credentials', dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-cloud-credentials'] });
    },
  });
}

export function useRevokeCloudCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: CloudProvider) =>
      api.delete<void>(`/ai-chat/cloud-credentials/${provider}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-cloud-credentials'] });
    },
  });
}

/**
 * The landing screen's data — see CLAUDE.md "Dashboard". GET despite
 * every other multi-step "generate" report in this app being POST
 * (VatPage/LiassePage/CashFlowPage/etc. all model theirs as a
 * useMutation, since their backend routes are POST) — the dashboard's
 * own `/dashboard/summary` route is a genuine read with no body, so
 * it's a real GET and a real useQuery, letting it load automatically
 * on mount rather than needing a "Générer" click.
 */
export function useDashboardSummary(fiscalYearId?: string | null) {
  return useQuery({
    queryKey: ['dashboard-summary', fiscalYearId],
    queryFn: () =>
      api.get<DashboardSummary>(
        `/dashboard/summary${fiscalYearId ? `?fiscalYearId=${encodeURIComponent(fiscalYearId)}` : ''}`,
      ),
  });
}

/**
 * Bank reconciliation — see CLAUDE.md "Bank reconciliation". Statement
 * import follows ImportExcelPage's own preview-then-confirm shape
 * (usePreviewImport/useConfirmImport). Match proposals are never
 * persisted server-side (recomputed fresh every call), so
 * useReconciliationProposals is a plain query, invalidated by every
 * mutation below that changes what's still UNMATCHED.
 */
export function useBankAccounts() {
  return useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccount[]>('/bank-accounts'),
  });
}

export function useCreateBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateBankAccountDto) => api.post<BankAccount>('/bank-accounts', dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
  });
}

function statementFormData(bankAccountId: string, file: File): FormData {
  const formData = new FormData();
  formData.append('bankAccountId', bankAccountId);
  formData.append('file', file);
  return formData;
}

/** Pure read — writes nothing server-side, safe to call as often as needed. */
export function usePreviewStatement() {
  return useMutation({
    mutationFn: ({ bankAccountId, file }: { bankAccountId: string; file: File }) =>
      api.postForm<StatementPreviewResponse>(
        '/bank-reconciliation/statements/preview',
        statementFormData(bankAccountId, file),
      ),
  });
}

function invalidateReconciliation(
  queryClient: ReturnType<typeof useQueryClient>,
  bankAccountId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ['bank-statement-lines', bankAccountId] });
  void queryClient.invalidateQueries({ queryKey: ['bank-reconciliation-proposals', bankAccountId] });
  void queryClient.invalidateQueries({ queryKey: ['ecritures'] });
}

/** The real commit — re-submits the same file previewed a moment earlier. */
export function useConfirmStatementImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bankAccountId, file }: { bankAccountId: string; file: File }) =>
      api.postForm<BankStatementImport>(
        '/bank-reconciliation/statements',
        statementFormData(bankAccountId, file),
      ),
    onSuccess: (_data, { bankAccountId }) => invalidateReconciliation(queryClient, bankAccountId),
  });
}

export function useStatementLines(bankAccountId: string | null) {
  return useQuery({
    queryKey: ['bank-statement-lines', bankAccountId],
    queryFn: () =>
      api.get<BankStatementLine[]>(`/bank-reconciliation/accounts/${bankAccountId}/statement-lines`),
    enabled: Boolean(bankAccountId),
  });
}

export function useReconciliationProposals(bankAccountId: string | null) {
  return useQuery({
    queryKey: ['bank-reconciliation-proposals', bankAccountId],
    queryFn: () =>
      api.get<StatementLineMatchProposal[]>(
        `/bank-reconciliation/accounts/${bankAccountId}/proposals`,
      ),
    enabled: Boolean(bankAccountId),
  });
}

export function useConfirmMatch(bankAccountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ statementLineId, ecritureLigneId }: { statementLineId: string; ecritureLigneId: string }) =>
      api.post<void>(`/bank-reconciliation/statement-lines/${statementLineId}/confirm-match`, {
        ecritureLigneId,
      }),
    onSuccess: () => invalidateReconciliation(queryClient, bankAccountId),
  });
}

export function useClearMatch(bankAccountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (statementLineId: string) =>
      api.post<void>(`/bank-reconciliation/statement-lines/${statementLineId}/clear-match`, {}),
    onSuccess: () => invalidateReconciliation(queryClient, bankAccountId),
  });
}

export function useIgnoreStatementLine(bankAccountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ statementLineId, reason }: { statementLineId: string; reason?: string }) =>
      api.post<void>(`/bank-reconciliation/statement-lines/${statementLineId}/ignore`, { reason }),
    onSuccess: () => invalidateReconciliation(queryClient, bankAccountId),
  });
}

export function useCreateEcritureFromStatementLine(bankAccountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ statementLineId, dto }: { statementLineId: string; dto: CreateEcritureDto }) =>
      api.post<EcritureWriteResult>(
        `/bank-reconciliation/statement-lines/${statementLineId}/create-ecriture`,
        dto,
      ),
    onSuccess: () => invalidateReconciliation(queryClient, bankAccountId),
  });
}

/**
 * Bank reconciliation — Layer 1b, live aggregator connectivity. See
 * CLAUDE.md "Bank reconciliation — Layer 1b". `useBankAggregatorLinks()`
 * is company-wide (a small list, one row per linked `BankAccount`) so
 * every consumer can key off `bankAccountId` client-side, same shape as
 * `useCloudCredentials()`. `syncNow` and `revoke` invalidate the same
 * reconciliation queries a manual statement import already invalidates
 * — a sync/revoke can change what's UNMATCHED/CONFIRMED exactly like a
 * manual import can.
 */
export function useBankAggregatorLinks() {
  return useQuery({
    queryKey: ['bank-aggregator-links'],
    queryFn: () => api.get<BankAggregatorLinkSummary[]>('/bank-aggregator/links'),
  });
}

export function useCreateConnectSession(bankAccountId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<{ connectUrl: string }>(`/bank-aggregator/links/${bankAccountId}/connect-session`, {}),
  });
}

export function useConfirmLink(bankAccountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (callbackPayload: Record<string, unknown>) =>
      api.post<BankAggregatorLinkSummary>(`/bank-aggregator/links/${bankAccountId}/confirm`, {
        callbackPayload,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bank-aggregator-links'] });
    },
  });
}

export function useSyncNow(bankAccountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ importedLines: number }>(`/bank-aggregator/links/${bankAccountId}/sync`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bank-aggregator-links'] });
      invalidateReconciliation(queryClient, bankAccountId);
    },
  });
}

export function useRevokeLink(bankAccountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/bank-aggregator/links/${bankAccountId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bank-aggregator-links'] });
    },
  });
}

/**
 * Invoicing — Phase A. See CLAUDE.md "Invoicing — Phase A" and
 * "Invoicing — Factur-X rendering". `findAll()`/`findOne()` on the
 * backend both already `include: { lines: true }`, so a single
 * ['invoices'] list query — same "no server-side filter, filter
 * client-side over a small dataset" shape as ['ecritures'] — covers
 * both the list and the editor without a second per-invoice fetch.
 */
function invalidateInvoices(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['invoices'] });
}

export function useInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get<Invoice[]>('/invoicing/invoices'),
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateInvoiceDto) => api.post<Invoice>('/invoicing/invoices', dto),
    onSuccess: () => invalidateInvoices(queryClient),
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: CreateInvoiceDto }) =>
      api.put<Invoice>(`/invoicing/invoices/${id}`, dto),
    onSuccess: () => invalidateInvoices(queryClient),
  });
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/invoicing/invoices/${id}`),
    onSuccess: () => invalidateInvoices(queryClient),
  });
}

/**
 * The gated core — assigns invoiceNumber, posts the écriture, computes
 * mentions. Throws (NotImplementedException, surfaced as an ApiError)
 * for an MC-jurisdiction company, with zero side effects — see
 * InvoicingService.finalize()'s own doc comment.
 */
export function useFinalizeInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: FinalizeInvoiceDto }) =>
      api.post<FinalizeInvoiceResult>(`/invoicing/invoices/${id}/finalize`, dto),
    onSuccess: () => invalidateInvoices(queryClient),
  });
}

/** Only meaningful for a FINALIZED invoice — re-derives mentions and ties them to the actual posted écriture. */
export function useInvoiceMentions(invoiceId: string | null) {
  return useQuery({
    queryKey: ['invoice-mentions', invoiceId],
    queryFn: () => api.get<InvoiceMentions>(`/invoicing/invoices/${invoiceId}/mentions`),
    enabled: Boolean(invoiceId),
  });
}

/**
 * Downloads the real Factur-X 1.09/EN16931 file (PDF/A-3, CII XML
 * embedded) for a FINALIZED invoice and triggers a browser save —
 * see CLAUDE.md "Invoicing — Factur-X rendering". A mutation, not a
 * query: it's a one-shot action with a side effect (the download),
 * not cached/reusable data.
 */
export function useDownloadFacturX() {
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const { filename, blob } = await api.getFileBlob(`/invoicing/invoices/${invoiceId}/factur-x`);
      downloadBlob(filename, blob);
    },
  });
}

/**
 * Downloads a devis (quote) PDF for a DRAFT invoice — see CLAUDE.md
 * "Invoicing — devis (quote) PDF". Client identity is EPHEMERAL
 * (DevisRequestDto) — never saved or locked, unlike finalize().
 */
export function useDownloadDevis() {
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: DevisRequestDto }) => {
      const { filename, blob } = await api.postFileBlob(`/invoicing/invoices/${id}/devis`, dto);
      downloadBlob(filename, blob);
    },
  });
}

/**
 * TVA sur les encaissements (CGI art. 269) — see CLAUDE.md "Invoicing —
 * cash-basis VAT". Reclassifies a SALE invoice's suspense VAT (445800)
 * into TVA collectée (445710), making it exigible.
 */
export function useMarkAsEncaisse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) =>
      api.post<Invoice>(`/invoicing/invoices/${invoiceId}/mark-encaisse`, {}),
    onSuccess: () => invalidateInvoices(queryClient),
  });
}
