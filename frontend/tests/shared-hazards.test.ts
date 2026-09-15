import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hazardsApi, type HazardReport } from '../src/features/dashboard/api/hazards.api';
import { authSession } from '../src/features/auth/auth-session';
import { screenEvacuationRoute } from '../src/features/dashboard/api/route-screening';
import type { EvacuationRoute } from '../src/features/dashboard/api/citizen-safety.api';

const browser = new EventTarget();
const doc = new EventTarget();
const intervals = new Map<number, () => void>();
let nextInterval = 0;
Object.assign(globalThis, {
  window: Object.assign(browser, {
    setTimeout, clearTimeout,
    setInterval: (callback: () => void) => { intervals.set(++nextInterval, callback); return nextInterval; },
    clearInterval: (id: number) => intervals.delete(id),
  }),
  document: Object.assign(doc, { hidden: false }),
});
function signIn(name: string, role: 'citizen' | 'worker' = 'citizen') {
  authSession.set({ access_token: `${name}-token`, token_type: 'bearer', expires_in: 900,
    user: { id: name, name, email: `${name}@example.com`, role } });
}
function report(id = 'hazard-1', changes = {}): HazardReport {
  return { id, kind: 'road_blocked', label: 'Road blocked', latitude: 30.05, longitude: -97,
    accuracy_m: 10, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    source: 'user_reported', reporter_source: 'citizen', status: 'active', has_photo: false,
    resolved_at: null, ...changes };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('all clients use the authenticated shared feed, never browser storage', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), 'http://test/api/v1/hazards?status=active');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer one-token');
    return response([report()]);
  };
  signIn('one');
  const [first, second] = await Promise.all([hazardsApi.refresh(), hazardsApi.refresh()]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.length, 1); // old report remains active: no six-hour silent expiry
});

test('one polling timer detects changed IDs at unchanged counts and cleans up', async () => {
  signIn('polling');
  let reports = [report()];
  globalThis.fetch = async () => response(reports);
  const changes: unknown[] = [];
  const onChange = (event: Event) => changes.push((event as CustomEvent).detail);
  window.addEventListener('jalrakshak:shared-hazards-changed', onChange);
  const stop1 = hazardsApi.subscribe(() => {});
  const stop2 = hazardsApi.subscribe(() => {});
  await flush();
  assert.equal(intervals.size, 1);
  reports = [report('hazard-2')];
  intervals.values().next().value!();
  await flush();
  assert.equal(hazardsApi.snapshot().reports[0].id, 'hazard-2');
  assert.equal(changes.length, 2);
  stop1(); assert.equal(intervals.size, 1);
  stop2(); assert.equal(intervals.size, 0);
  window.removeEventListener('jalrakshak:shared-hazards-changed', onChange);
});

test('save uses server identity and save failure is never reported as success', async () => {
  signIn('uploader');
  const payload = { client_request_id: 'a-client-id', kind: 'road_blocked' as const,
    latitude: 30.05, longitude: -97, accuracy_m: 10 };
  globalThis.fetch = async (_url, options) => {
    assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(options?.body)), payload);
    return response({ detail: 'Unable to store report' }, 503);
  };
  await assert.rejects(hazardsApi.create(payload), /Unable to store report/);
  globalThis.fetch = async (_url, options) => options?.method === 'POST'
    ? response(report('server-id'), 201) : response({ detail: 'Feed down' }, 503);
  assert.equal((await hazardsApi.create(payload)).id, 'server-id');
  assert.match(hazardsApi.snapshot().error!, /Feed down/);
});

test('GET started before a write cannot overwrite the new shared snapshot', async () => {
  signIn('race');
  let deliver: (response: Response) => void;
  let gets = 0;
  globalThis.fetch = async (_url, options) => {
    if (options?.method === 'POST') return response(report('new'), 201);
    if (++gets === 1) return new Promise<Response>(resolve => { deliver = resolve; });
    return response([report('new')]);
  };
  const pending = hazardsApi.refresh();
  const rejected = assert.rejects(pending, /Hazards changed/);
  await hazardsApi.create({ client_request_id: 'retry-key', kind: 'road_blocked', latitude: 30, longitude: -97, accuracy_m: null });
  deliver!(response([]));
  await rejected;
  assert.equal(hazardsApi.snapshot().reports[0].id, 'new');
});

const baseRoute: EvacuationRoute = { destination_name: 'Test destination', destination_type: 'test',
  destination_latitude: 30.1, destination_longitude: -97, distance_m: 12000, duration_s: 600,
  geometry: [], steps: [], alternatives_considered: 1, prototype_safety_score: 90, reasons: [],
  source: 'test', warning: 'test' };
const direct = { distance: 12000, duration: 600, geometry: { coordinates: [[-97, 30], [-97, 30.1]] } };
const detour = { distance: 15000, duration: 800,
  geometry: { coordinates: [[-97, 30], [-97.02, 30.02], [-97.02, 30.08], [-97, 30.1]] } };

test('citizen and responder sessions reject the same segment-interior hazard', async () => {
  globalThis.fetch = async url => String(url).includes('/hazards')
    ? response([report()]) : response({ routes: [direct, detour] });
  for (const role of ['citizen', 'worker'] as const) {
    signIn(`routing-${role}`, role);
    const screened = await screenEvacuationRoute(30, -97, baseRoute);
    assert.equal(screened.screening_status, 'complete');
    assert.equal(screened.rejected_count, 1);
    assert.equal(screened.recommended_count, 1);
    assert.equal(screened.duration_s, 800);
    assert.match(screened.screened_routes![0].rejection_reasons![0], /hazard-1/);
  }
});

test('all blocked means no recommendation; resolved reports restore eligibility', async () => {
  signIn('blocked');
  let reports = [report()];
  globalThis.fetch = async url => String(url).includes('/hazards')
    ? response(reports) : response({ routes: [direct] });
  const blocked = await screenEvacuationRoute(30, -97, baseRoute);
  assert.equal(blocked.recommended_count, 0);
  assert.equal(blocked.rejected_count, 1);
  reports = []; // active-only endpoint omits the now-resolved hazard
  assert.equal((await screenEvacuationRoute(30, -97, baseRoute)).recommended_count, 1);
});

test('backend or routing outage never becomes a hazard-free recommendation', async () => {
  for (const failure of ['hazards', 'routing']) {
    signIn(`outage-${failure}`);
    globalThis.fetch = async url => {
      const hazards = String(url).includes('/hazards');
      return hazards === (failure === 'hazards') ? response({ detail: 'Unavailable' }, 503)
        : response(hazards ? [] : { routes: [direct] });
    };
    const result = await screenEvacuationRoute(30, -97, baseRoute);
    assert.equal(result.screening_status, 'pending');
    assert.equal(result.recommended_count, 0);
    assert.deepEqual(result.screened_routes, []);
  }
});

test('signed-out reads do not return a previous session cache', async () => {
  authSession.clear();
  await assert.rejects(hazardsApi.refresh(), /Sign in/);
  assert.deepEqual(hazardsApi.snapshot().reports, []);
});
