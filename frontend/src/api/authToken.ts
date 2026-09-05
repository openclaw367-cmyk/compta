/**
 * The in-memory access token — see CLAUDE.md "Multi-user / roles &
 * permissions". A module-level variable, same pattern as
 * `currentCompanyId` in client.ts, deliberately NEVER localStorage/
 * sessionStorage (reduces what an XSS bug could steal — losing this on
 * a hard refresh is exactly the point, since AuthProvider re-mints it
 * via the httpOnly refresh-token cookie on every app boot).
 *
 * `refreshHandler` is registered once by AuthProvider on mount — this
 * module can't import AuthProvider itself (a React component importing
 * a plain API module, not the other way around), so the actual
 * POST /auth/refresh call + resulting user/status state update lives in
 * AuthProvider, and this module just knows how to ASK for a refresh.
 * `refreshAccessToken()` de-duplicates concurrent callers (several
 * requests 401-ing at once must trigger exactly one refresh, not one
 * each) by sharing a single in-flight promise.
 */
let currentAccessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  currentAccessToken = token;
}

export function getAccessToken(): string | null {
  return currentAccessToken;
}

type RefreshHandler = () => Promise<string | null>;

let refreshHandler: RefreshHandler | null = null;

export function setRefreshHandler(fn: RefreshHandler): void {
  refreshHandler = fn;
}

let refreshInFlight: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshHandler) return Promise.resolve(null);
  if (!refreshInFlight) {
    refreshInFlight = refreshHandler().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
