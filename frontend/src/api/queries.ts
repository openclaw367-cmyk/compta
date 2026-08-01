import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Account,
  AccountLedgerResponse,
  Ecriture,
  FiscalYear,
  Journal,
  TrialBalanceResponse,
} from './types';
import type { CreateEcritureDto, CreateTiersDto, UpdateAccountDto } from './dto';

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

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<Account[]>('/accounts'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useFiscalYears() {
  return useQuery({
    queryKey: ['fiscal-years'],
    queryFn: () => api.get<FiscalYear[]>('/fiscal-years'),
    staleTime: 5 * 60 * 1000,
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
    mutationFn: (dto: CreateEcritureDto) => api.post<Ecriture>('/entries', dto),
    onSuccess: () => invalidateEcrituresAndLedger(queryClient),
  });
}

export function useUpdateEcriture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: CreateEcritureDto }) =>
      api.patch<Ecriture>(`/entries/${id}`, dto),
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
