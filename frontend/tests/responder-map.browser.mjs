// Run against a local Vite server, with ONLY mocked API data and local Leaflet assets.
// npm install --no-save --package-lock=false playwright leaflet@1.9.4
// npx playwright install chromium
// TEST_APP_URL=http://127.0.0.1:5173 node tests/responder-map.browser.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.stack ?? error.message));
page.setDefaultTimeout(12000);
const now = new Date().toISOString();
const live = { id: 'SOS-test', citizen_id: 'citizen-test', citizen_name: 'Test Citizen', emergency_type: 'rescue', latitude: 29.7179, longitude: -95.402, accuracy_m: 35, people_count: 1, notes: '', risk_score: 25, risk_level: 'low', precipitation_next_6h_mm: 0.1, river_discharge_m3s: 4.3, status: 'assigned', created_at: now, updated_at: now, responder_id: 'worker-test', responder_name: 'Test Responder', is_demo: false };
const demo = { ...live, id: 'DEMO-test', citizen_name: 'Demo Incident', latitude: 27.7172, longitude: 85.324, is_demo: true };
const hazard = { id: 'HAZ-test', kind: 'other', label: 'Other hazard', latitude: live.latitude, longitude: live.longitude, accuracy_m: 35, created_at: now, updated_at: now, resolved_at: null, source: 'user_reported', reporter_source: 'citizen', status: 'active', has_photo: false };
let records = [live, demo];
let reports = [hazard];
let failResolution = true;
let failHazards = false;
let resolveCalls = 0;
let hazardReads = 0;
const headers = { 'access-control-allow-origin': new URL(process.env.TEST_APP_URL ?? 'http://127.0.0.1:5173').origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type,authorization,accept', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };

await page.route('**/api/v1/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  if (url.pathname === '/api/v1/hazards') {
    hazardReads++;
    assert.equal(request.headers().authorization, 'Bearer browser-test-only');
    return failHazards ? json({ detail: 'Test feed unavailable' }, 503) : json(reports);
  }
  if (url.pathname === '/api/v1/hazards/HAZ-test' && request.method() === 'PATCH') {
    resolveCalls++;
    assert.deepEqual(request.postDataJSON(), { status: 'resolved' });
    if (failResolution) { failResolution = false; return json({ detail: 'Test resolution temporarily unavailable' }, 503); }
    reports = [];
    return json({ ...hazard, status: 'resolved', resolved_at: new Date().toISOString() });
  }
  if (url.pathname === '/api/v1/emergencies') {
    return json(records.filter(r => (!url.searchParams.has('status') || r.status === url.searchParams.get('status')) && (!url.searchParams.has('is_demo') || String(r.is_demo) === url.searchParams.get('is_demo'))));
  }
  if (url.pathname.startsWith('/api/v1/emergencies/')) {
    const record = records.find(r => r.id === url.pathname.split('/')[4]);
    return record ? json(record) : json({ detail: 'Not found' }, 404);
  }
  return json({ detail: 'No test provider connected' }, 503);
});
await page.route('https://unpkg.com/leaflet@1.9.4/dist/**', route => {
  const filename = new URL(route.request().url()).pathname.split('/').at(-1);
  return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, path: fileURLToPath(new URL(`../node_modules/leaflet/dist/${filename}`, import.meta.url)) });
});
// No external map provider is required to test real Leaflet projection and layout.
await page.route('https://server.arcgisonline.com/**', route => route.fulfill({
  contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f3f0e6"/><path d="M0 128H256M128 0V256" stroke="#d8d0bc"/><text x="12" y="24" fill="#756c57" font-size="12">Test tile — mocked basemap</text></svg>',
}));
await page.route('https://router.project-osrm.org/**', route => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'Mock routing provider unavailable' }));
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition: () => 1, clearWatch: () => {}, getCurrentPosition: (_ok, fail) => fail?.({ code: 1, message: 'Test GPS disabled' }) }, configurable: true });
});
const nav = name => page.locator(`[data-worker-nav="${name}"]`);
async function assertView(view) {
  await page.waitForFunction(v => document.querySelector('.ops-shell')?.dataset.workerView === v, view);
  assert.deepEqual(await page.locator('.ops-nav .active').evaluateAll(nodes => nodes.map(n => n.dataset.workerNav)), [view]);
  assert.equal(await page.locator('.ops-nav [aria-current="page"]').count(), 1);
}
const mapState = () => page.evaluate(() => {
  const map = document.querySelector('[data-responder-map]').responderMap.map;
  const center = map.getCenter();
  return { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
});
async function openMap() {
  await nav('map').click(); await assertView('map');
  await page.waitForFunction(() => Boolean(document.querySelector('[data-responder-map]')?.responderMap));
}
const waitCount = (selector, count) => page.waitForFunction(({selector, count}) => document.querySelectorAll(selector).length === count, {selector, count});

try {
  await page.goto(process.env.TEST_APP_URL ?? 'http://127.0.0.1:5173');
  await page.waitForSelector('#root > *');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('g0ne:authenticated', { detail: { access_token: 'browser-test-only', token_type: 'bearer', expires_in: 900, user: { id: 'worker-test', role: 'worker', name: 'Test Responder', email: 'worker@test.invalid' } } })));
  await assertView('queue');
  await page.waitForSelector('.ops-queue-list button');
  await openMap();
  await waitCount('.ops-geographic-incident', 1);
  await waitCount('.jalrakshak-user-hazard-marker', 1);
  assert.equal(await page.locator('.ops-risk-wash,.ops-safe-zone,.ops-map-basemap').count(), 0);
  const initial = await mapState();
  assert.ok(Math.abs(initial.lat - live.latitude) < .001 && Math.abs(initial.lng - live.longitude) < .001);
  assert.equal(initial.zoom, 14);
  await page.getByRole('button', { name: 'DEMO incidents', exact: true }).click();
  await waitCount('.ops-geographic-incident', 2);
  assert.deepEqual(await mapState(), initial, 'Distant demo must not zoom out to a world map');
  console.log('PASS geographic map, live-only default, shared hazard and stable demo toggle');

  await page.evaluate(() => document.querySelector('[data-responder-map]').responderMap.map.setView([29.73, -95.41], 13));
  const panned = await mapState();
  const readsBefore = hazardReads;
  await page.waitForFunction(() => document.querySelector('.ops-map-detail-grid')?.textContent.includes('AGE'));
  await page.waitForTimeout(5600);
  assert.ok(hazardReads > readsBefore, 'Polling continues');
  assert.deepEqual(await mapState(), panned, 'Polling must preserve pan/zoom');
  await page.getByRole('button', { name: 'Show reported hazards (1)', exact: true }).click();
  const projection = await page.evaluate(({latitude, longitude}) => {
    const host = document.querySelector('[data-responder-map]');
    const point = host.responderMap.map.latLngToContainerPoint([latitude, longitude]);
    const mapRect = host.getBoundingClientRect();
    const marker = document.querySelector('.jalrakshak-user-hazard-marker').getBoundingClientRect();
    return Math.hypot(marker.x + marker.width/2 - mapRect.x - point.x, marker.y + marker.height/2 - mapRect.y - point.y);
  }, hazard);
  assert.ok(projection < 2, 'Hazard icon must be anchored to its GPS position');
  console.log('PASS geographic marker alignment and polling preserves user viewport');

  for (const view of ['dashboard', 'map', 'queue', 'dashboard', 'reports', 'settings', 'dashboard', 'map']) {
    await nav(view).click(); await assertView(view);
    if (view === 'dashboard') await page.waitForSelector('[data-admin-dashboard]');
    else if (view === 'reports') await page.waitForSelector('[data-operational-reports] h1');
    else if (view === 'settings') await page.waitForSelector(`[data-worker-static-view="${view}"] h1`);
    else if (view === 'map') await page.waitForFunction(() => Boolean(document.querySelector('[data-responder-map]')?.responderMap));
    else await page.waitForSelector('.ops-queue-pane');
  }
  await page.waitForTimeout(5600); await assertView('map');
  assert.equal(await page.locator('.leaflet-container').count(), 1);
  console.log('PASS single sidebar selection, all five views, map teardown/remount and poll');

  await page.evaluate(record => {
    sessionStorage.setItem('jalrakshak:responder-route-handoff', JSON.stringify({ incidentId: record.id, responderPosition: { latitude: record.latitude, longitude: record.longitude - .005 }, updatedAt: new Date().toISOString(), candidates: [{ distanceM: 500, durationS: 120, geometry: [[record.longitude - .005, record.latitude], [record.longitude, record.latitude]], safetyScore: 0, status: 'rejected', reason: 'Test rejected route' }] }));
    window.dispatchEvent(new Event('jalrakshak:live-route-opened'));
  }, live);
  await page.waitForFunction(() => document.querySelector('[data-responder-map]')?.responderMap?.routeLayer?.getLayers().some(layer => typeof layer.getLatLngs === 'function'));
  const routePoints = await page.evaluate(() => document.querySelector('[data-responder-map]').responderMap.routeLayer.getLayers().find(layer => typeof layer.getLatLngs === 'function').getLatLngs().map(p => [p.lat, p.lng]));
  assert.deepEqual(routePoints, [[live.latitude, live.longitude - .005], [live.latitude, live.longitude]]);
  await page.locator('[data-route-layer-toggle]').click();
  await page.waitForFunction(() => !document.querySelector('[data-responder-map]').responderMap.routeLayer);
  await page.evaluate(() => { sessionStorage.removeItem('jalrakshak:responder-route-handoff'); window.dispatchEvent(new Event('jalrakshak:live-route-opened')); });
  await waitCount('[data-live-route-card]', 0);
  console.log('PASS existing route handoff uses geographic lines and route visibility toggle');

  await page.getByRole('button', { name: 'Show reported hazards (1)', exact: true }).click();
  await page.locator('.jalrakshak-user-hazard-marker').click();
  if (process.env.TEST_SCREENSHOT_PATH) {
    await page.waitForTimeout(350); // Let tile/popup fade transitions settle for visual inspection.
    await page.screenshot({ path: process.env.TEST_SCREENSHOT_PATH, fullPage: true });
  }
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Test resolution temporarily unavailable', exact: true });
  await retry.waitFor(); assert.equal(await retry.isEnabled(), true);
  assert.equal(await page.locator('.jalrakshak-user-hazard-marker').count(), 1);
  await retry.click();
  await waitCount('.jalrakshak-user-hazard-marker', 0);
  await page.getByRole('button', { name: 'Show reported hazards (0)', exact: true }).waitFor();
  assert.equal(resolveCalls, 2);
  console.log('PASS worker hazard resolution, failed-write retry and shared-feed removal');

  await page.getByRole('button', { name: 'Open Incident', exact: true }).click();
  await assertView('queue');
  assert.match(await page.locator('.ops-id-row').innerText(), /SOS-test/);
  await page.locator('[data-incident-filter="new"]').click();
  await page.waitForSelector('.ops-empty');
  await openMap();
  await page.getByRole('button', { name: 'Focus selected SOS', exact: true }).click();
  const selectedWithFilter = await mapState();
  await page.waitForTimeout(5600);
  assert.deepEqual(await mapState(), selectedWithFilter, 'Queue filter must not reset map selection on poll');
  console.log('PASS map-to-incident navigation and independent queue/map selection');

  reports = [hazard]; records = [];
  await nav('dashboard').click(); await assertView('dashboard');
  await page.waitForTimeout(5600);
  await openMap();
  await waitCount('.ops-geographic-incident', 0);
  await waitCount('.jalrakshak-user-hazard-marker', 1);
  await page.getByRole('button', { name: 'Show reported hazards (1)', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const bounds = await page.locator('[data-responder-map]').boundingBox();
  assert.ok(bounds.width > 150 && bounds.height >= 400);
  assert.ok(bounds.x + bounds.width <= 391, 'Mobile map must fit the viewport');
  failHazards = true;
  await page.waitForFunction(() => document.querySelector('.leaflet-container')?.textContent.includes('Shared hazards unavailable'), null, {timeout: 10000});
  assert.equal(await page.locator('.jalrakshak-user-hazard-marker').count(), 1, 'Outage preserves markers with stale warning');
  await nav('dashboard').click(); await assertView('dashboard');
  await page.waitForTimeout(250);
  const lastRead = hazardReads;
  await page.waitForTimeout(5600);
  assert.equal(hazardReads, lastRead, 'Hazard poller stops when map unmounts');
  assert.deepEqual(errors, []);
  console.log('PASS hazards without SOS, mobile layout, stale feed warning and polling cleanup');
  console.log('All responder map/navigation browser regressions passed (mocked APIs and basemap).');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error((await page.locator('body').innerText()).slice(0, 5000));
  throw error;
} finally { await browser.close(); }
