/**
 * Holds the logged-in session (user + access token) in memory only.
 * Not persisted to localStorage, so a page refresh signs the user out. That's safer (no token for
 * XSS to steal from storage) at the cost of convenience.
 */
import type { LoginResponse } from './types/auth.types';

let currentSession: LoginResponse | null = null;

export const authSession = {
  set(session: LoginResponse) {
    currentSession = session;
  },
  get() {
    return currentSession;
  },
  clear() {
    currentSession = null;
  },
};
