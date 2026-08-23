import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCurrentCompanyId } from '../api/client';
import type { Company, FiscalYear } from '../api/types';
import { AppContext, type AppContextValue } from './appContextStore';

const COMPANY_ID_STORAGE_KEY = 'compta:companyId';

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(() =>
    localStorage.getItem(COMPANY_ID_STORAGE_KEY),
  );
  const [fiscalYearId, setFiscalYearId] = useState<string | null>(null);

  const companiesQuery = useQuery({
    queryKey: ['app-companies'],
    queryFn: () => api.get<Company[]>('/companies'),
    staleTime: 5 * 60 * 1000,
  });
  const companies = useMemo(() => companiesQuery.data ?? [], [companiesQuery.data]);

  // Default to the first company once the list loads, if nothing is
  // selected yet or the persisted selection no longer exists (a stale
  // localStorage value from a company that was since removed elsewhere).
  useEffect(() => {
    if (companies.length === 0) return;
    if (!companyId || !companies.some((c) => c.id === companyId)) {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  // The one place this selection actually takes effect: every request
  // after this carries the right x-company-id (see api/client.ts), and
  // the query cache is reset so already-fetched pages refetch under the
  // new tenant instead of briefly showing the previous company's data.
  useEffect(() => {
    setCurrentCompanyId(companyId);
    if (companyId) {
      localStorage.setItem(COMPANY_ID_STORAGE_KEY, companyId);
      void queryClient.resetQueries();
    }
    // Re-resolved below once this company's own fiscal years load.
    setFiscalYearId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only on companyId change, not on every queryClient identity
  }, [companyId]);

  const fiscalYearsQuery = useQuery({
    queryKey: ['app-fiscal-years', companyId],
    queryFn: () => api.get<FiscalYear[]>('/fiscal-years'),
    enabled: Boolean(companyId),
    staleTime: 60 * 1000,
  });
  const fiscalYears = useMemo(() => fiscalYearsQuery.data ?? [], [fiscalYearsQuery.data]);

  // Same "open, else most recent" default the dashboard itself uses —
  // see DashboardService.getSummary() on the backend.
  useEffect(() => {
    if (fiscalYears.length === 0) return;
    if (!fiscalYearId || !fiscalYears.some((y) => y.id === fiscalYearId)) {
      const open = fiscalYears.find((y) => y.closedAt === null);
      setFiscalYearId((open ?? fiscalYears[0]).id);
    }
  }, [fiscalYears, fiscalYearId]);

  const currentCompany = companies.find((c) => c.id === companyId) ?? null;
  const currentFiscalYear = fiscalYears.find((y) => y.id === fiscalYearId) ?? null;

  const value = useMemo<AppContextValue>(
    () => ({
      companies,
      companiesLoading: companiesQuery.isLoading,
      companyId,
      currentCompany,
      setCompanyId,
      fiscalYears,
      fiscalYearsLoading: fiscalYearsQuery.isLoading,
      fiscalYearId,
      currentFiscalYear,
      setFiscalYearId,
    }),
    [
      companies,
      companiesQuery.isLoading,
      companyId,
      currentCompany,
      fiscalYears,
      fiscalYearsQuery.isLoading,
      fiscalYearId,
      currentFiscalYear,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
