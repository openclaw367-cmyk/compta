import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  PreferencesContext,
  type DensityPreference,
  type PreferencesContextValue,
  type ThemePreference,
} from './preferencesStore';

const THEME_KEY = 'compta:theme';
const DENSITY_KEY = 'compta:density';
const LANDING_ROUTE_KEY = 'compta:defaultLandingRoute';
const DEFAULT_LANDING_ROUTE = '/tableau-de-bord';

function readTheme(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function readDensity(): DensityPreference {
  return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readTheme);
  const [density, setDensityState] = useState<DensityPreference>(readDensity);
  const [defaultLandingRoute, setDefaultLandingRouteState] = useState(
    () => localStorage.getItem(LANDING_ROUTE_KEY) ?? DEFAULT_LANDING_ROUTE,
  );

  // "system" stamps nothing, so the CSS media query alone governs it —
  // matches index.html's own inline pre-paint script exactly, so there's
  // never a flash between the inline script's guess and this provider's.
  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    if (density === 'compact') {
      document.documentElement.setAttribute('data-density', 'compact');
    } else {
      document.documentElement.removeAttribute('data-density');
    }
  }, [density]);

  function setTheme(next: ThemePreference) {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
  }

  function setDensity(next: DensityPreference) {
    setDensityState(next);
    localStorage.setItem(DENSITY_KEY, next);
  }

  function setDefaultLandingRoute(next: string) {
    setDefaultLandingRouteState(next);
    localStorage.setItem(LANDING_ROUTE_KEY, next);
  }

  const value: PreferencesContextValue = {
    theme,
    setTheme,
    density,
    setDensity,
    defaultLandingRoute,
    setDefaultLandingRoute,
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
