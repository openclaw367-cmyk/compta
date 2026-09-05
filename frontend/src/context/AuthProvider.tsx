import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { authRequest } from '../api/client';
import { setAccessToken, setRefreshHandler } from '../api/authToken';
import type { AuthResponse, AuthUser } from '../api/types';
import { AuthContext, type AuthContextValue, type AuthStatus } from './authContextStore';

/**
 * See CLAUDE.md "Multi-user / roles & permissions" for the full session
 * design. On mount, always attempts a silent POST /auth/refresh against
 * the httpOnly refresh-token cookie BEFORE anything gated renders — this
 * is what makes "close the tab, reopen tomorrow, still logged in" work.
 * Also registers itself as `client.ts`'s refresh handler (via
 * `setRefreshHandler`), so a 401 mid-session on ANY API call triggers
 * this exact same refresh path — one implementation, two entry points.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  // Avoids a double-fire in React 18 StrictMode's dev-only double-invoke
  // of effects, which would otherwise race two /auth/refresh calls.
  const hasBootedRef = useRef(false);

  const doRefresh = useCallback(async (): Promise<string | null> => {
    try {
      const result = await authRequest<AuthResponse | { accessToken: null; user: null }>(
        '/auth/refresh',
      );
      if (!result.accessToken || !result.user) {
        setAccessToken(null);
        setUser(null);
        setStatus('unauthenticated');
        return null;
      }
      setAccessToken(result.accessToken);
      setUser(result.user);
      setStatus('authenticated');
      return result.accessToken;
    } catch {
      setAccessToken(null);
      setUser(null);
      setStatus('unauthenticated');
      return null;
    }
  }, []);

  useEffect(() => {
    setRefreshHandler(doRefresh);
    if (hasBootedRef.current) return;
    hasBootedRef.current = true;
    void doRefresh();
  }, [doRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authRequest<AuthResponse>('/auth/login', { email, password });
    setAccessToken(result.accessToken);
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const signup = useCallback(async (email: string, password: string, companyName: string) => {
    const result = await authRequest<AuthResponse>('/auth/signup', {
      email,
      password,
      companyName,
    });
    setAccessToken(result.accessToken);
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const acceptInvite = useCallback(async (token: string, password?: string) => {
    const result = await authRequest<AuthResponse>('/auth/accept-invite', { token, password });
    setAccessToken(result.accessToken);
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await authRequest('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value: AuthContextValue = { status, user, login, signup, acceptInvite, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
