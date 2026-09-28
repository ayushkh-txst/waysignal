/**
 * Shared fetch wrapper for the backend API.
 * Adds JSON headers and the bearer token, enforces a timeout, and normalizes every failure
 * into an ApiError so callers only handle one error type.
 */
import { authSession } from '../features/auth/auth-session';

// Set VITE_API_BASE_URL at build time for deployed environments.
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
  // AbortController lets us cancel fetch after timeoutMs (fetch has no built-in timeout).
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(init?.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    // Callers can override Authorization; otherwise attach the current session token.
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
    // Map network and timeout failures to ApiError: 408 = timed out, 0 = server unreachable.
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(408, "The server took too long to respond.");
    }
    // NOTE: user-facing text still says "JalRakshak" (the project's old name).
    throw new ApiError(0, "Unable to reach the JalRakshak API.");
  } finally {
    window.clearTimeout(timeout);
  }
}
