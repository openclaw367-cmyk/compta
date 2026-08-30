import type { ApiErrorBody } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/**
 * The app-wide selected company (see context/AppContext.tsx) — a module-
 * level variable rather than a parameter threaded through every one of
 * this file's ~60 call sites in queries.ts. `AppProvider` calls
 * `setCurrentCompanyId()` once whenever the selection changes (and resets
 * the TanStack Query cache in the same beat, so every hook refetches
 * scoped to the new tenant); every request from then on carries the
 * right `x-company-id` automatically, with zero per-hook changes. `null`
 * (before the picker has resolved on first load) omits the header
 * entirely, which is exactly the backend's own pre-existing
 * single-company fallback (`CompanyContextMiddleware`) — never a broken
 * state, just the same behavior this app already had before a picker
 * existed.
 */
let currentCompanyId: string | null = null;

export function setCurrentCompanyId(companyId: string | null): void {
  currentCompanyId = companyId;
}

function companyHeaders(): Record<string, string> {
  return currentCompanyId ? { 'x-company-id': currentCompanyId } : {};
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData bodies (file upload) must NOT get an explicit Content-Type —
  // fetch sets multipart/form-data with the correct boundary itself, and
  // overriding it here would break the boundary and the upload with it.
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
      ...companyHeaders(),
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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'text/plain', ...companyHeaders() },
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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: companyHeaders(),
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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: companyHeaders(),
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
};
