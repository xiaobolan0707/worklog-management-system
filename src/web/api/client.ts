export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: "EMPLOYEE" | "LEADER" | "MANAGEMENT" | "ADMIN";
  mustChangePassword: boolean;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(value: string | null) {
  csrfToken = value;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (csrfToken && init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) {
    headers.set("x-csrf-token", csrfToken);
  }
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string; message?: string };
    throw new ApiError(response.status, body.code ?? "REQUEST_FAILED", body.message ?? "请求失败");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
