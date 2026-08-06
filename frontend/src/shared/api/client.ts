import type { ApiErrorPayload, CommandAck, CurrentUser, LoginResponse } from "../contracts";

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.toString().trim();
const API_BASE = configuredApiBase && configuredApiBase !== "/"
  ? configuredApiBase.replace(/\/+$/, "")
  : "";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function throwApiError(response: Response): Promise<never> {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  const message = typeof payload === "object" && payload !== null && "error" in payload
    ? payload.error?.message || "Ошибка запроса к API"
    : "Ошибка запроса к API";
  const code = typeof payload === "object" && payload !== null && "error" in payload
    ? payload.error?.code
    : undefined;
  throw new ApiError(message, response.status, code);
}

export async function apiResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) await throwApiError(response);
  return response;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiResponse(path, init);
  return response.json().catch(() => null) as Promise<T>;
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function getCurrentUser(): Promise<CurrentUser> {
  return apiRequest<CurrentUser>("/api/v1/auth/me");
}

export function changePassword(payload: { current_password: string; new_password: string }): Promise<CommandAck> {
  return apiRequest<CommandAck>("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logout(): Promise<void> {
  return apiRequest<CommandAck>("/api/v1/auth/logout", { method: "POST" }).then(() => undefined);
}
