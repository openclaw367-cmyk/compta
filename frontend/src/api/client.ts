import type { ApiErrorBody } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

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
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { Accept: 'text/plain' } });

  if (!response.ok) {
    const body: unknown = await response.json();
    throw new ApiError(body as ApiErrorBody);
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export.txt';
  const content = await response.text();
  return { filename, content };
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, data: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, formData: FormData): Promise<T> =>
    request<T>(path, { method: 'POST', body: formData }),
  getFile: (path: string): Promise<DownloadableFile> => requestFile(path),
};
