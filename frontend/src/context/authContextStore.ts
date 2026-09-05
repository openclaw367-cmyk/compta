import { createContext, useContext } from 'react';
import type { AuthUser } from '../api/types';

/**
 * Auth state — deliberately separate from AppContext (company/fiscal-year
 * selection, which only exists once a user is signed in). See
 * CLAUDE.md "Multi-user / roles & permissions".
 *
 * `status`:
 *  - 'loading': the boot-time silent refresh (POST /auth/refresh against
 *    the httpOnly cookie) is still in flight — render nothing gated yet.
 *  - 'unauthenticated': no valid session — <RequireAuth> redirects to /login.
 *  - 'authenticated': `user` is set, the app renders normally.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, companyName: string) => Promise<void>;
  acceptInvite: (token: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be used within <AuthProvider>.');
  }
  return ctx;
}
