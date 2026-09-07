"use client";

// Browser-side fetch wrapper for the /api/v1 REST API (doc 07 §7.1 envelope).
// Same-origin, so the browser attaches the session cookie automatically.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ data: null, error: null }));
  if (!res.ok || json.error) {
    throw new ApiError(res.status, json.error?.code ?? "UNKNOWN", json.error?.message ?? "Request failed", json.error?.details);
  }
  return json.data as T;
}

// Multipart upload — no Content-Type header set manually; the browser generates the
// correct multipart boundary itself when the body is a FormData instance.
async function requestForm<T>(path: string, files: File[]): Promise<T> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const res = await fetch(path, { method: "POST", body: form });
  const json = await res.json().catch(() => ({ data: null, error: null }));
  if (!res.ok || json.error) {
    throw new ApiError(res.status, json.error?.code ?? "UNKNOWN", json.error?.message ?? "Upload failed", json.error?.details);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  uploadFiles: <T>(path: string, files: File[]) => requestForm<T>(path, files),
};
