import { createContext, useContext } from 'react';
import type { Company, FiscalYear } from '../api/types';

/**
 * The app-wide company + fiscal-year selection — see CLAUDE.md
 * "Navigation" and TopBar.tsx, its one visible surface. Pure context
 * switching: this changes WHICH data every screen fetches (via
 * `setCurrentCompanyId()` for the company, and `fiscalYearId` as the
 * default a page's own report-generation call is seeded with), never
 * HOW anything computes. Nothing here calls a generate()/compute
 * endpoint itself.
 *
 * Split from AppProvider.tsx (the component that actually populates
 * this) purely so this file only exports the context/hook and that one
 * only exports a component — a plain component file mixing the two trips
 * react-refresh's "only export components" rule.
 */
export interface AppContextValue {
  companies: Company[];
  companiesLoading: boolean;
  companyId: string | null;
  currentCompany: Company | null;
  setCompanyId: (id: string) => void;

  fiscalYears: FiscalYear[];
  fiscalYearsLoading: boolean;
  fiscalYearId: string | null;
  currentFiscalYear: FiscalYear | null;
  setFiscalYearId: (id: string) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext() must be used within <AppProvider>.');
  }
  return ctx;
}
