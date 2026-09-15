// Starts Vite and real FastAPI + temporary SQLite; external providers/GPS/tiles are mocked.
// TEST_PYTHON=/absolute/venv/bin/python CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/citizen-map.browser.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const appUrl = process.env.TEST_APP_URL || 'http://127.0.0.1:5173';
const backendDir = resolve(process.env.TEST_BACKEND_DIR || '../backend');
const temp = await mkdtemp(join(tmpdir(), 'citizen-map-'));
const python = process.env.TEST_PYTHON || 'python3';
const server = spawn(python, ['-c', `
from datetime import datetime, timezone
import uvicorn
from app.main import app
from app.core import database
from app.api.v1 import citizen_map, routing
from app.api.v1.emergencies import Emergency
async def label(lat, lon):
    return citizen_map.PlaceLabel(primary='Houston test road' if lat > 28 else 'Kathmandu test road', secondary=f'{lat:.5f}, {lon:.5f}', source='ArcGIS reverse geocoding')
async def destinations(lat, lon):
    return [dict(id='osm-node-test', name='Mapped community facility', type='community_centre', latitude=lat+0.01, longitude=lon+0.01, priority=1, air_distance_m=1400)]
async def road_routes(lat, lon, destination):
    return [dict(distance=2000, duration=480, geometry={'coordinates': [[lon,lat],[destination['longitude'],destination['latitude']]]}, legs=[{'steps': [{'name':'Test road','distance':2000,'duration':480,'maneuver':{'type':'depart'}}]}])]
citizen_map.location_label=label
citizen_map._nearby_destinations=destinations
routing._nearby_destinations=destinations
routing._osrm_routes=road_routes
database.initialize_database()
with database.SessionLocal() as db:
    for id, citizen in [('SOS-own','citizen-demo'),('SOS-other','other-citizen')]:
        db.add(Emergency(id=id,citizen_id=citizen,citizen_name=citizen,emergency_type='rescue',latitude=29.7179,longitude=-95.402,people_count=1,notes='',status='assigned',is_demo=False,created_at=datetime.now(timezone.utc),responder_id='worker-demo',responder_name='Test responder',responder_latitude=29.72,responder_longitude=-95.41,recommended_route={'geometry':[[29.72,-95.41],[29.7179,-95.402]]}))
    db.commit()
uvicorn.run(app,host='127.0.0.1',port=8000,log_level='error')
`], { cwd: backendDir, env: { ...process.env, JWT_SECRET: 'isolated-browser-map-secret-not-for-production-0123456789', DATABASE_URL: `sqlite:///${join(temp, 'map.db')}`, FRONTEND_ORIGIN: appUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', x => logs += x); server.stderr.on('data', x => logs += x);
let browser;
let vite;
try {
  if (!process.env.TEST_APP_URL) {
    vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { host: '127.0.0.1', port: 5173, strictPort: true } });
    await vite.listen();
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch('http://127.0.0.1:8000/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(e.stack || e.message));
  await page.route('https://unpkg.com/leaflet@1.9.4/dist/**', route => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, path: fileURLToPath(new URL(`../node_modules/leaflet/dist/${new URL(route.request().url()).pathname.split('/').at(-1)}`, import.meta.url)) }));
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef1ed"/><path d="M0 128H256M128 0V256" stroke="#fff" stroke-width="14"/><text x="12" y="28" fill="#60705e" font-size="12">Test street tile</text></svg>' }));
  await page.route('https://router.project-osrm.org/**', route => {
    const path = new URL(route.request().url()).pathname.split('/').at(-1);
    const coordinates = path.split(';').map(p => p.split(',').map(Number));
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'Ok', routes: [{ distance: 2000, duration: 480, geometry: { coordinates }, legs: [{ steps: [{ name: 'Test road', distance: 2000, duration: 480, maneuver: { type: 'depart' } }] }] }] }) });
  });
  await page.addInitScript(() => {
    window.testGPS = null;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (ok, fail) => window.testGPS ? ok({ coords: { ...window.testGPS, accuracy: 15 } }) : fail({ code: 1 }),
      watchPosition: () => 1, clearWatch: () => {},
    } });
  });
  await page.goto(appUrl);
  await page.locator('input[type=email]').fill('citizen@example.com');
  await page.locator('input[type=password]').fill('CitizenDemo2026!');
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/citizen');
  await page.getByRole('button', { name: 'View Details', exact: true }).click();
  const nav = name => page.locator('.figma-nav button').filter({ hasText: name });
  await nav('Live Map').click();
  await page.waitForFunction(() => document.querySelector('[data-citizen-map]')?.citizenMap);
  await page.waitForFunction(() => document.querySelector('.citizen-map-source')?.textContent.includes('1 active request'));
  assert.equal(await page.locator('.citizen-geo-marker.sos').count(), 1);
  assert.equal(await page.locator('.citizen-geo-marker.responder').count(), 1);
  assert.equal(await page.locator('.citizen-geo-marker.person').count(), 0);
  assert.match(await page.locator('.location-line').innerText(), /MAP PREVIEW/);
  assert.equal(await page.locator('.citizen-street-map .leaflet-tile-pane').evaluate(el => getComputedStyle(el).filter), 'none');
  assert.equal(await page.locator('.route-start').isDisabled(), true);
  await page.getByRole('button', { name: /Use my location/ }).click();
  assert.match(await page.locator('.map-status-row').innerText(), /permission unavailable/);
  const state = () => page.evaluate(() => { const m = document.querySelector('[data-citizen-map]').citizenMap.map; return { center: m.getCenter(), zoom: m.getZoom(), id: m._leaflet_id }; });
  await page.evaluate(() => document.querySelector('[data-citizen-map]').citizenMap.map.setView([29.8, -95.3], 13));
  const before = await state();
  await page.getByRole('button', { name: 'Nearby facilities', exact: true }).click();
  assert.equal(await page.locator('.citizen-geo-marker.facility').count(), 0);
  assert.deepEqual(await state(), before);
  await page.getByRole('button', { name: 'Nearby facilities', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.citizen-geo-marker.facility'));
  await page.evaluate(() => { window.testGPS = { latitude: 29.7179, longitude: -95.402 }; });
  await page.getByRole('button', { name: /Use my location/ }).click();
  await page.waitForFunction(() => document.querySelector('.route-start')?.disabled === false);
  assert.equal(await page.locator('.citizen-geo-marker.person').count(), 1);
  assert.match(await page.locator('.location-line').innerText(), /Houston test road.*GPS/);
  assert.equal(await page.locator('.route-analysis-summary').count(), 1);
  assert.match(await page.locator('.route-analysis-summary').innerText(), /1[\s\S]*Recommended/i);
  // Backend changes are consumed through the authenticated citizen feed.
  await page.evaluate(async () => {
    await fetch('http://localhost:8000/api/v1/emergencies/SOS-own/location', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ latitude: 29.718, longitude: -95.403, accuracy_m: 12 }) });
  });
  await page.waitForFunction(() => { const m = document.querySelector('[data-citizen-map]').citizenMap.map; return Object.values(m._layers).some(l => l.options?.title === 'Your rescue request' && Math.abs(l.getLatLng().lat - 29.718) < 1e-6); });
  const afterPoll = await state();
  assert.equal(afterPoll.id, before.id);
  // Shared backend reports affect both map visibility and route eligibility.
  const login = await fetch('http://127.0.0.1:8000/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'worker@example.com', password: 'WorkerDemo2026!' }) }).then(r => r.json());
  const report = await fetch('http://127.0.0.1:8000/api/v1/hazards', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.access_token}` }, body: JSON.stringify({ client_request_id: crypto.randomUUID(), kind: 'road_blocked', latitude: 29.7229, longitude: -95.397, accuracy_m: 10 }) }).then(r => r.json());
  await page.waitForFunction(() => document.querySelector('.jalrakshak-user-hazard-marker'));
  await page.getByRole('button', { name: 'Reported hazards', exact: true }).click();
  assert.equal(await page.locator('.jalrakshak-user-hazard-marker').count(), 0);
  await page.getByRole('button', { name: /Use my location/ }).click();
  await page.waitForFunction(() => document.querySelector('.route-panel h2')?.textContent.includes('No route currently recommended'));
  assert.equal(await page.locator('.route-start').isDisabled(), true);
  assert.equal(await page.locator('.jalrakshak-user-hazard-marker').count(), 0);
  await page.getByRole('button', { name: 'Reported hazards', exact: true }).click();
  assert.equal(await page.locator('.jalrakshak-user-hazard-marker').count(), 1);
  await fetch(`http://127.0.0.1:8000/api/v1/hazards/${report.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.access_token}` }, body: JSON.stringify({ status: 'resolved' }) });
  await page.waitForFunction(() => !document.querySelector('.jalrakshak-user-hazard-marker'));
  // Location names outside Texas must not be rewritten into Houston.
  await page.evaluate(() => { window.testGPS = { latitude: 27.7172, longitude: 85.324 }; });
  await page.getByRole('button', { name: /Use my location/ }).click();
  await page.waitForFunction(() => document.querySelector('.location-line')?.textContent.includes('Kathmandu test road'));
  assert.doesNotMatch(await page.locator('.location-line').innerText(), /Houston|Harris/);
  await page.waitForFunction(() => document.querySelector('.route-start')?.disabled === false);
  // Provider error: retain explorable map and report lookup failure without invented facilities.
  await page.route('**/api/v1/citizen-map/places?**', route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': appUrl, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ detail: 'Test places outage' }) }));
  await page.getByRole('button', { name: 'Refresh places', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.citizen-map-source')?.textContent.includes('Test places outage'));
  assert.equal((await state()).id, before.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const out = process.env.TEST_SCREENSHOT_DIR || temp;
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: join(out, 'citizen-map-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: join(out, 'citizen-map-desktop.png'), fullPage: true });
  await nav('Overview').click(); await nav('Live Map').click();
  await page.waitForFunction(() => document.querySelector('[data-citizen-map]')?.citizenMap);
  assert.deepEqual(errors, []);
  console.log('Citizen map browser checks passed: real API/SQLite, scoped SOS, geographic markers, GPS/labels, route UI, layer stability, polling, failure states, remount and mobile.');
} finally {
  await browser?.close(); await vite?.close(); server.kill('SIGTERM');
  await new Promise(r => server.exitCode !== null ? r() : server.once('exit', r));
  await rm(temp, { recursive: true, force: true });
}
