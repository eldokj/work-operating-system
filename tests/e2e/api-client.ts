// Minimal cookie-jar HTTP client for driving the real API as a specific logged-in user —
// each ApiClient instance represents one user's browser session.

export interface ApiResult<T = unknown> {
  status: number;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

export class ApiClient {
  private cookie: string | null = null;

  constructor(private readonly baseUrl: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      this.cookie = setCookie.split(";")[0] ?? null;
    }

    const json = (await res.json().catch(() => ({ data: null, error: null }))) as {
      data: T | null;
      error: ApiResult["error"];
    };

    return { status: res.status, data: json.data, error: json.error };
  }

  get<T>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, body);
  }
  delete<T>(path: string) {
    return this.request<T>("DELETE", path);
  }

  /** Multipart upload — mirrors apps/web/lib/api-client.ts's uploadFiles. */
  async uploadFiles<T>(path: string, files: Array<{ fileName: string; mimeType: string; data: Buffer }>): Promise<ApiResult<T>> {
    const form = new FormData();
    for (const file of files) {
      form.append("files", new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.fileName);
    }
    const res = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: this.cookie ? { Cookie: this.cookie } : {},
      body: form,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0] ?? null;
    const json = (await res.json().catch(() => ({ data: null, error: null }))) as {
      data: T | null;
      error: ApiResult["error"];
    };
    return { status: res.status, data: json.data, error: json.error };
  }

  /** Raw (non-JSON) GET — for secure file retrieval, which returns binary content or a
   * redirect rather than the {data,error} envelope. */
  async getRaw(path: string): Promise<{ status: number; contentType: string | null; body: Buffer }> {
    const res = await fetch(this.baseUrl + path, {
      headers: this.cookie ? { Cookie: this.cookie } : {},
      redirect: "manual",
    });
    const body = res.status >= 300 && res.status < 400 ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
    return { status: res.status, contentType: res.headers.get("content-type"), body };
  }
}
