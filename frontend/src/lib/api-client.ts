import { authSession } from '../features/auth/auth-session';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string; message?: string };
    return body.detail ?? body.message ?? "Request failed";
  } catch {
    return "Request failed";
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(init?.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const token = authSession.get()?.access_token;
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      throw new ApiError(response.status, await getErrorMessage(response));
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(408, "The server took too long to respond.");
    }
    throw new ApiError(0, "Unable to reach the JalRakshak API.");
  } finally {
    window.clearTimeout(timeout);
  }
}
