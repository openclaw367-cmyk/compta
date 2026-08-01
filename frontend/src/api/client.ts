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

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, data: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, formData: FormData): Promise<T> =>
    request<T>(path, { method: 'POST', body: formData }),
};
