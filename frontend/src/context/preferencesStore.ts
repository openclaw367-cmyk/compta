import { createContext, useContext } from 'react';

/**
 * App-level display preferences — theme, table density, default landing
 * screen. Every one of these changes how the UI presents itself, never
 * what's computed: no preference here reaches an API call or a money
 * value. Persisted to localStorage only (no backend field exists or is
 * needed for a client-only display preference), same pattern as the
 * company/fiscal-year selection in appContextStore.ts.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type DensityPreference = 'comfortable' | 'compact';

export interface PreferencesContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  density: DensityPreference;
  setDensity: (density: DensityPreference) => void;
  /** A route path, e.g. "/tableau-de-bord" or "/ecritures" — where "/" redirects to. */
  defaultLandingRoute: string;
  setDefaultLandingRoute: (route: string) => void;
  /** Hides the sidebar entirely so the current screen fills the width — see AppShell.tsx. */
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences() must be used within <PreferencesProvider>.');
  }
  return ctx;
}
