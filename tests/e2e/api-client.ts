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
}
