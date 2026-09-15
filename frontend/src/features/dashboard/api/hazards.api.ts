import { apiRequest } from '../../../lib/api-client';
import { authSession } from '../../auth/auth-session';

export type HazardKind = 'road_blocked' | 'flooded_road' | 'debris' | 'other';
export type HazardReport = {
  id: string; kind: HazardKind; label: string;
  latitude: number; longitude: number; accuracy_m: number | null;
  created_at: string; updated_at: string; resolved_at: string | null;
  source: 'user_reported'; reporter_source: 'citizen' | 'worker';
  status: 'active' | 'resolved'; has_photo: boolean;
};
export type HazardSubmission = {
  client_request_id: string; kind: HazardKind;
  latitude: number; longitude: number; accuracy_m: number | null;
  photo_base64?: string;
};
export type HazardSnapshot = { reports: HazardReport[]; checkedAt: string | null; error: string | null };

let snapshot: HazardSnapshot = { reports: [], checkedAt: null, error: null };
let sessionToken: string | null = null;
let revision = '';
let generation = 0;
let inflight: Promise<HazardReport[]> | null = null;
let interval: number | null = null;
const listeners = new Set<(state: HazardSnapshot) => void>();
function notify() { listeners.forEach(listener => listener(snapshot)); }
function credentials() {
  const token = authSession.get()?.access_token ?? null;
  if (token !== sessionToken) {
    generation++;
    sessionToken = token;
    inflight = null;
    revision = '';
    snapshot = { reports: [], checkedAt: null, error: null };
  }
  if (!token) throw new Error('Sign in to load shared hazard reports.');
  return { token, headers: { Authorization: `Bearer ${token}` } };
}

/** Only this fresh server read may be used to approve a route. Cache is for display. */
async function refresh(): Promise<HazardReport[]> {
  let auth: ReturnType<typeof credentials>;
  try { auth = credentials(); }
  catch (error) {
    snapshot = { reports: [], checkedAt: null, error: (error as Error).message };
    notify();
    throw error;
  }
  if (inflight) return inflight;
  const startedGeneration = generation;
  const request = apiRequest<HazardReport[]>('/hazards?status=active', { headers: auth.headers, cache: 'no-store' })
    .then(reports => {
      if (authSession.get()?.access_token !== auth.token || generation !== startedGeneration) throw new Error('Hazards changed; reload the shared feed.');
      const nextRevision = JSON.stringify(reports.map(report => [report.id, report.updated_at]));
      const changed = revision !== nextRevision;
      revision = nextRevision;
      snapshot = { reports, checkedAt: new Date().toISOString(), error: null };
      notify();
      if (changed) window.dispatchEvent(new CustomEvent('jalrakshak:shared-hazards-changed', { detail: reports }));
      return reports;
    }).catch(error => {
      if (authSession.get()?.access_token === auth.token && generation === startedGeneration) {
        snapshot = { ...snapshot, error: error instanceof Error ? error.message : 'Shared hazard feed unavailable.' };
        notify();
      }
      throw error;
    }).finally(() => { if (inflight === request) inflight = null; });
  inflight = request;
  return request;
}

function poll() { if (!document.hidden) void refresh().catch(() => {}); }

export const hazardsApi = {
  refresh,
  snapshot: () => snapshot,
  async create(payload: HazardSubmission): Promise<HazardReport> {
    const auth = credentials();
    const report = await apiRequest<HazardReport>('/hazards', {
      method: 'POST', headers: auth.headers, body: JSON.stringify(payload),
    }, 20_000);
    // A failed follow-up read must not turn a successful save into a failed upload.
    if (authSession.get()?.access_token === auth.token) {
      generation++;
      inflight = null; // Ignore a GET started before this write.
      await refresh().catch(() => {});
    }
    return report;
  },
  async setStatus(id: string, status: 'active' | 'resolved') {
    const report = await apiRequest<HazardReport>(`/hazards/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: credentials().headers, body: JSON.stringify({ status }),
    });
    generation++;
    inflight = null;
    await refresh().catch(() => {});
    return report;
  },
  photo: (id: string) => apiRequest<{data_url: string}>(`/hazards/${encodeURIComponent(id)}/photo`, {
    headers: credentials().headers,
  }),
  /** One shared timer; it stops when the last visible consumer unmounts. */
  subscribe(listener: (state: HazardSnapshot) => void) {
    listeners.add(listener);
    listener(snapshot);
    if (interval === null) {
      interval = window.setInterval(poll, 5000);
      window.addEventListener('focus', poll);
      document.addEventListener('visibilitychange', poll);
      poll();
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size && interval !== null) {
        window.clearInterval(interval);
        interval = null;
        window.removeEventListener('focus', poll);
        document.removeEventListener('visibilitychange', poll);
      }
    };
  },
};
