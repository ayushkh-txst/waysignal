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
