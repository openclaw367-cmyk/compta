import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/authContextStore';

/**
 * Gates every existing app route behind a signed-in session — see
 * CLAUDE.md "Multi-user / roles & permissions". Renders nothing (a bare
 * themed background, no flash of unauthenticated content) while the
 * boot-time silent refresh is in flight; only a genuinely failed refresh
 * (no valid session at all) redirects to /login. AppProvider (company/
 * fiscal-year selection) is nested INSIDE this component in App.tsx,
 * not alongside it — that's what makes "company/fiscal-year queries
 * never fire before auth resolves" true structurally.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return <div className="h-screen bg-bg" />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
