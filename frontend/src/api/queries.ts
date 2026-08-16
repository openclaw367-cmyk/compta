import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Account,
  AccountLedgerResponse,
  Ca3Declaration,
  CashFlowStatement,
  CessionResult,
  Company,
  DepreciationEntry,
  Ecriture,
  EcritureWriteResult,
  FiscalYear,
  FixedAsset,
  ImportBatch,
  ImportPreviewResponse,
  Journal,
  LiasseAnyResult,
  TrialBalanceResponse,
  VatRate,
} from './types';
import type {
  CessionFixedAssetDto,
  CreateAccountDto,
  CreateEcritureDto,
  CreateFiscalYearDto,
  CreateFixedAssetDto,
  CreateJournalDto,
  CreateTiersDto,
  CreateVatRateDto,
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
