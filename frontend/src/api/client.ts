import type { ApiErrorBody } from './types';
import { getAccessToken, refreshAccessToken } from './authToken';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/**
 * The app-wide selected company (see context/AppContext.tsx) — a module-
 * level variable rather than a parameter threaded through every one of
 * this file's ~60 call sites in queries.ts. `AppProvider` calls
 * `setCurrentCompanyId()` once whenever the selection changes (and resets
 * the TanStack Query cache in the same beat, so every hook refetches
 * scoped to the new tenant); every request from then on carries the
 * right `x-company-id` automatically, with zero per-hook changes.
 */
let currentCompanyId: string | null = null;

export function setCurrentCompanyId(companyId: string | null): void {
  currentCompanyId = companyId;
}

function companyHeaders(): Record<string, string> {
  return currentCompanyId ? { 'x-company-id': currentCompanyId } : {};
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Thrown for any non-2xx response; carries the backend's own error message(s). */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly details: string[];

  constructor(body: ApiErrorBody) {
    const details = Array.isArray(body.message) ? body.message : [body.message];
    super(details.join(' '));
    this.name = 'ApiError';
    this.statusCode = body.statusCode;
    this.details = details;
  }
}

/**
 * The "never randomly logged out" mechanism — see CLAUDE.md "Multi-user
 * / roles & permissions". Every request goes through here. A 401 means
 * the access token expired mid-session (it's only good for ~15 min); we
 * silently exchange the httpOnly refresh cookie for a new one
 * (de-duplicated across concurrent 401s by refreshAccessToken() itself)
 * and retry the SAME request once with the fresh token. Only a failed
 * refresh (the refresh token itself is invalid/expired/revoked)
 * surfaces the original 401 to the caller, which is what AuthProvider's
 * own refresh handler treats as "log out." `/auth/*` calls are never
 * retried this way — retrying a failed refresh call itself would loop.
 */
async function fetchWithAuthRetry(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (response.status !== 401 || path.startsWith('/auth/')) {
    return response;
  }
  const newToken = await refreshAccessToken();
  if (!newToken) {
    return response;
  }
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${newToken}` },
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData bodies (file upload) must NOT get an explicit Content-Type —
  // fetch sets multipart/form-data with the correct boundary itself, and
  // overriding it here would break the boundary and the upload with it.
  const isFormData = init?.body instanceof FormData;
  const response = await fetchWithAuthRetry(path, {
    ...init,
    headers: {
      ...(init?.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
      ...companyHeaders(),
      ...authHeaders(),
      ...init?.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json();

  if (!response.ok) {
    throw new ApiError(body as ApiErrorBody);
  }

  return body as T;
}

export interface DownloadableFile {
  filename: string;
  content: string;
}

/**
 * For text/plain download endpoints (FEC export) — not JSON, so it can't
 * go through request(). The filename comes from the server's
 * Content-Disposition header (the single source of truth for the naming
 * rule, e.g. "{SIREN}FEC{ClotureDate}.txt" — see CLAUDE.md), which
 * requires the backend to set exposedHeaders in its CORS config, since
 * that header isn't in the browser's default CORS-safelisted set.
 */
async function requestFile(path: string): Promise<DownloadableFile> {
  const response = await fetchWithAuthRetry(path, {
    headers: { Accept: 'text/plain', ...companyHeaders(), ...authHeaders() },
  });

  if (!response.ok) {
    const body: unknown = await response.json();
    throw new ApiError(body as ApiErrorBody);
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export.txt';
  const content = await response.text();
  return { filename, content };
}

/**
 * For the document viewer (see CLAUDE.md "Supporting-document
 * attachments") — a binary GET that can't go through request() (not
 * JSON) and can't be a plain `<img src="...">`/`<embed src="...">`
 * either, since the file route requires the x-company-id header a raw
 * element src can't attach. The caller turns the Blob into an object URL
 * (and revokes it on close).
 */
async function requestBlob(path: string): Promise<Blob> {
  const response = await fetchWithAuthRetry(path, {
    headers: { ...companyHeaders(), ...authHeaders() },
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    throw new ApiError(body as ApiErrorBody);
  }
  return response.blob();
}

export interface DownloadableBlob {
  filename: string;
  blob: Blob;
}

/**
 * For binary download endpoints with a real filename (the Factur-X
 * file) — like requestFile() but the body is a Blob (a PDF), not text.
 * Same Content-Disposition/exposedHeaders dependency as requestFile().
 */
async function requestFileBlob(path: string): Promise<DownloadableBlob> {
  const response = await fetchWithAuthRetry(path, {
    headers: { ...companyHeaders(), ...authHeaders() },
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    throw new ApiError(body as ApiErrorBody);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
  const blob = await response.blob();
  return { filename, blob };
}

/** Same shape as requestFileBlob(), but POSTs a JSON body first — for the devis PDF
 *  endpoint, which needs the ephemeral client-identity form in its request body. */
async function requestFileBlobPost(path: string, data: unknown): Promise<DownloadableBlob> {
  const response = await fetchWithAuthRetry(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...companyHeaders(), ...authHeaders() },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    throw new ApiError(body as ApiErrorBody);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
  const blob = await response.blob();
  return { filename, blob };
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, data: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  put: <T>(path: string, data: unknown): Promise<T> =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, formData: FormData): Promise<T> =>
    request<T>(path, { method: 'POST', body: formData }),
  putForm: <T>(path: string, formData: FormData): Promise<T> =>
    request<T>(path, { method: 'PUT', body: formData }),
  getFile: (path: string): Promise<DownloadableFile> => requestFile(path),
  getBlob: (path: string): Promise<Blob> => requestBlob(path),
  getFileBlob: (path: string): Promise<DownloadableBlob> => requestFileBlob(path),
  postFileBlob: (path: string, data: unknown): Promise<DownloadableBlob> =>
    requestFileBlobPost(path, data),
};

/**
 * Auth calls (login/signup/refresh/logout) need the refresh-token
 * cookie sent/received — `credentials:'include'` is required for a
 * cross-origin fetch (Vite dev on :5173, API on :3000) to carry a
 * cookie at all; ordinary API calls never need this (they authenticate
 * via the Authorization header, not a cookie). Kept as a small,
 * separate helper rather than folded into request() so that distinction
 * stays explicit and impossible to accidentally apply everywhere.
 */
export async function authRequest<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new ApiError(body as ApiErrorBody);
  }
  return body as T;
}
