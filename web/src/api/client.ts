export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("No identity token available");
    this.name = "NotAuthenticatedError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getIdToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface ApiClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

/**
 * Wraps fetch and always sets `Authorization: Bearer <idToken>` (Req 1.2).
 * Requests are never sent without a token.
 */
export function createApiClient({ baseUrl, getIdToken, fetchImpl }: ApiClientOptions): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");
  const doFetch = fetchImpl ?? ((input, init) => fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getIdToken();
    if (!token) throw new NotAuthenticatedError();

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await doFetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) throw new ApiError(res.status, parsed);
    return parsed as T;
  }

  return {
    request,
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    delete: (path) => request("DELETE", path),
  };
}
