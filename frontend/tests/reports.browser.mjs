// Real frontend + FastAPI HTTP + temporary SQLite. Never uses the development DB.
// TEST_PYTHON=/path/to/python CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/reports.browser.mjs
// Browser dependency: playwright. Uses an installed Chromium or Playwright's default.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const backend = process.env.TEST_BACKEND_DIR || resolve(frontend, '../backend');
const directory = await mkdtemp(join(tmpdir(), 'jalrakshak-reports-e2e-'));
const api = 'http://127.0.0.1:8019/api/v1';
const app = 'http://127.0.0.1:5179';
let backendLog = '';
const serverProcess = spawn(process.env.TEST_PYTHON || 'python', ['-c', `
from datetime import datetime, timedelta, timezone
from app.main import app
from app.core import database
from app.api.v1.emergencies import Emergency
import uvicorn
database.initialize_database()
now = datetime.now(timezone.utc)
with database.SessionLocal() as db:
    for i in range(14):
        created = now - timedelta(days=i % 6, minutes=60)
        resolved = i % 3 == 0
        db.add(Emergency(id=f'SOS-TEST-{i:02}', citizen_id='isolated-fixture', citizen_name='Isolated Browser Fixture', emergency_type=['rescue','medical','evacuation'][i%3], latitude=29.7179 if i%2 else 29.74, longitude=-95.402, people_count=i%4+1, notes='Isolated test fixture', risk_score=[88,65,45,20][i%4], status='resolved' if resolved else 'assigned', responder_id='worker-demo', responder_name='Test Worker', created_at=created, acknowledged_at=created+timedelta(minutes=2), assigned_at=created+timedelta(minutes=4), resolved_at=created+timedelta(minutes=30) if resolved else None, location_updated_at=now-timedelta(seconds=30 if i%2 else 600), accuracy_m=12 if i%2 else 50, is_demo=False))
    db.add(Emergency(id='SOS-LEGACY', citizen_id='isolated-legacy', citizen_name='Isolated Legacy Fixture', emergency_type='rescue', latitude=29, longitude=-95, people_count=1, notes='Isolated legacy test fixture', status='assigned', responder_id='worker-demo', created_at=now-timedelta(days=30), accuracy_m=35, is_demo=False))
    db.commit()
uvicorn.run(app, host='127.0.0.1', port=8019, log_level='warning')
`], { cwd: directory, env: { ...process.env, PYTHONPATH: backend,
  DATABASE_URL: `sqlite:///${join(directory, 'isolated.db')}`,
  JWT_SECRET: 'isolated-browser-test-secret-never-for-deployment-123',
  DEMO_WORKER_EMAIL: 'worker@example.com', DEMO_WORKER_PASSWORD: 'IsolatedTest2026!',
  FRONTEND_ORIGIN: app, ENVIRONMENT: 'development',
}, stdio: ['ignore', 'pipe', 'pipe'] });
serverProcess.stdout.on('data', chunk => { backendLog += chunk; });
serverProcess.stderr.on('data', chunk => { backendLog += chunk; });
let browser, vite;
const errors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function json(path, init = {}) {
  const response = await fetch(api + path, init);
  assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}

try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch('http://127.0.0.1:8019/health')).ok) break; } catch {}
    if (serverProcess.exitCode !== null || attempt === 49) throw new Error(backendLog || 'Backend did not start');
    await wait(150);
  }
  const session = await json('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'worker@example.com', password: 'IsolatedTest2026!' }) });
  const auth = { Authorization: `Bearer ${session.access_token}` };
  process.env.VITE_API_BASE_URL = api;
  vite = await createServer({ root: frontend, server: { host: '127.0.0.1', port: 5179, strictPort: true } });
  await vite.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  // No outside services are needed for report metrics. All local API calls remain real.
  await page.route(/^https:\/\//, route => route.abort());
  await page.goto(app); await page.waitForSelector('#root > *');
  await page.evaluate(session => window.dispatchEvent(new CustomEvent('g0ne:authenticated', { detail: session })), session);
  await page.locator('[data-worker-nav="reports"]').click();
  const metrics = page.locator('.report-metrics');
  await page.waitForSelector('.report-metrics');
  assert.equal(await metrics.locator('article').first().locator('strong').innerText(), '14');
  assert.equal(await page.locator('.ops-nav [aria-current="page"]').count(), 1);
  assert.equal(await page.locator('[data-worker-nav="chat"]').count(), 0);
  const expected = await json('/admin/reports', { headers: auth });
  assert.equal(expected.summary.total, 14);
  assert.equal(await page.locator('.report-lower-grid tbody tr').count(), expected.locations_summary.length);
  console.log('PASS Reports reads real FastAPI aggregates and excludes seeded demo incidents');

  const gps = page.getByLabel('GPS location', { exact: true });
  assert.ok((await page.locator('#report-gps-suggestions option').evaluateAll(options => options.map(option => option.value))).includes('29.718, -95.402'));
  await gps.fill('  +29.71799, -95.40200  ');
  await page.locator('.report-gps-pending').waitFor();
  assert.equal(await metrics.locator('strong').first().innerText(), '14', 'Typing does not apply an unfinished filter');
  await gps.press('Enter');
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '7');
  assert.match(await page.locator('.report-gps-applied').innerText(), /29.718, -95.402/);
  const gpsDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ Export CSV' }).click();
  const gpsCsv = await readFile(await (await gpsDownloadPromise).path(), 'utf8');
  assert.equal(gpsCsv.split('\n').filter(line => /^SOS-TEST/.test(line)).length, 7);
  assert.ok(gpsCsv.includes('location=29.718, -95.402'));
  if (process.env.TEST_GPS_SCREENSHOT_PATH) await page.screenshot({ path: process.env.TEST_GPS_SCREENSHOT_PATH, fullPage: true });
  await gps.fill('91, -95.402');
  await page.getByRole('button', { name: 'Apply GPS filter' }).click();
  assert.match(await page.locator('#report-gps-error').innerText(), /Latitude must be between/);
  assert.equal(await metrics.locator('strong').first().innerText(), '7', 'Invalid GPS preserves the applied results');
  assert.equal(await gps.getAttribute('aria-invalid'), 'true');
  await gps.fill('29.718,');
  await gps.press('Enter');
  assert.match(await page.locator('#report-gps-error').innerText(), /Enter latitude, longitude/);
  await page.getByRole('button', { name: 'Clear GPS filter' }).click();
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '14');
  assert.equal(await gps.inputValue(), '');
  await gps.fill('27.7172, 85.3240');
  await page.getByRole('button', { name: 'Apply GPS filter' }).click();
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '0');
  await gps.fill('');
  await gps.press('Enter');
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '14');
  console.log('PASS manual GPS precision, Enter/Apply, draft isolation, validation, no-match/clear states and matching real CSV');

  await page.getByLabel('Incident type', { exact: true }).selectOption('medical');
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '5');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ Export CSV' }).click();
  const download = await downloadPromise;
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.split('\n').filter(line => /^SOS-TEST/.test(line)).length, 5);
  assert.ok(!csv.includes('DEMO-'));
  await page.getByLabel('Status', { exact: true }).selectOption('resolved');
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '0');
  await page.getByText('No non-demo incidents match', { exact: false }).waitFor();
  await page.getByLabel('Status', { exact: true }).selectOption('');
  await page.getByLabel('Incident type', { exact: true }).selectOption('');
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '14');
  await page.getByLabel('Prototype risk', { exact: true }).selectOption('critical');
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '4');
  await page.getByLabel('Prototype risk', { exact: true }).selectOption('');
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '14');
  console.log('PASS combined filters, empty state, and backend CSV download match');

  for (const name of ['response', 'evacuation', 'after action', 'overview']) {
    await page.getByRole('tab', { name, exact: true }).click();
    assert.equal(await page.getByRole('tab', { selected: true }).count(), 1);
    assert.ok((await page.getByRole('tabpanel').innerText()).length > 100);
  }
  assert.equal(await page.getByRole('tab', { name: 'alerts', exact: true }).count(), 0);
  await page.locator('.report-definitions summary').click();
  await page.getByText('Alert delivery, shelter occupancy, and offline sync analytics are not connected yet', { exact: false }).waitFor();
  await page.locator('.report-definitions summary').click();

  // Reproduce the user's real condition: one old assigned SOS with no action history.
  await page.getByLabel('Date range', { exact: true }).selectOption('90');
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '15');
  await page.getByLabel('GPS location').fill('29.000, -95.000');
  await page.getByRole('button', { name: 'Apply GPS filter' }).click();
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '1');
  assert.deepEqual(await metrics.locator('strong').allTextContents(), ['1', '1', '1', '0', '0', '0']);
  await page.getByRole('tab', { name: 'response', exact: true }).click();
  assert.deepEqual(await page.locator('.report-current-status strong').allTextContents(), ['0', '1', '0', '0', '0']);
  assert.equal(await page.locator('.report-timings').count(), 0, 'No empty timing cards for legacy data');
  await page.getByText('Response times are not available for this incident.', { exact: true }).waitFor();
  const legacy = page.locator('tr').filter({ hasText: 'SOS-LEGACY' });
  assert.match(await legacy.innerText(), /Time not recorded/);
  assert.match(await legacy.innerText(), /Not resolved/);
  assert.ok(!await legacy.innerText().then(text => text.includes('—')));
  if (process.env.TEST_SPARSE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.TEST_SPARSE_SCREENSHOT_PATH, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'Sparse response report fits mobile');
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.getByRole('tab', { name: 'evacuation', exact: true }).click();
  await page.getByText('No evacuation requests match this selection.', { exact: false }).waitFor();
  assert.deepEqual(await page.locator('.report-content .report-response-metrics strong').allTextContents(), ['0', '0', '0', '0']);
  assert.equal(await page.getByRole('heading', { name: 'Safe-zone occupancy' }).count(), 0);
  await page.getByRole('button', { name: 'Clear GPS filter' }).click();
  await page.getByLabel('Date range', { exact: true }).selectOption('7');
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '14');
  await page.getByRole('tab', { name: 'response', exact: true }).click();
  assert.equal(await page.locator('.report-timings article').count(), 3, 'Show only acknowledgment, assignment and resolution with recorded samples');
  assert.equal(await page.locator('.report-history-note').count(), 0);
  console.log('PASS one legacy SOS shows numeric current statuses, accurate missing-time labels, and no fabricated timing/shelter/alert data');
  await page.getByRole('tab', { name: 'overview', exact: true }).click();
  await page.getByLabel('GPS location').fill(expected.locations[0]);
  await page.getByLabel('GPS location').press('Enter');
  const count = expected.locations_summary[0].incidents;
  await page.waitForFunction(count => document.querySelector('.report-metrics article strong')?.textContent === String(count), count);
  await page.getByRole('button', { name: 'Clear GPS filter' }).click();
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '14');

  const created = await json('/emergencies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ citizen_id: 'isolated-new', citizen_name: 'Isolated New Request', emergency_type: 'medical', latitude: 29.7, longitude: -95.4, accuracy_m: 30, people_count: 2 }) });
  // Wait for the ordinary report poll, with no refresh or mocked report response.
  await page.waitForFunction(() => document.querySelector('.report-metrics article strong')?.textContent === '15', null, { timeout: 20000 });
  await page.getByRole('tab', { name: 'after action', exact: true }).click();
  await page.locator('tr').filter({ hasText: created.id }).getByRole('button', { name: 'Open incident' }).click();
  await page.waitForFunction(id => document.querySelector('.ops-id-row > span')?.textContent === id, created.id);
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('.ops-header-actions button')).some(button => button.textContent === 'Acknowledge'));
  assert.ok((await json(`/emergencies/${created.id}`)).acknowledged_at);
  await page.getByRole('button', { name: 'Assign Responder', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.timeline-row.current')?.textContent.includes('Assigned'));
  assert.ok((await json(`/emergencies/${created.id}`)).assigned_at);
  await page.locator('[data-worker-nav="reports"]').click(); await page.waitForSelector('.report-metrics');
  console.log('PASS live polling picks up a saved request, report-to-incident navigation, acknowledgment and assignment persist');

  await page.screenshot({ path: process.env.TEST_SCREENSHOT_PATH || join(directory, 'reports-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'Mobile page must not overflow horizontally');
  assert.equal(await page.locator('.report-metrics article').count(), 6);
  if (process.env.TEST_MOBILE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.TEST_MOBILE_SCREENSHOT_PATH, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Deliberately lose the backend after a good snapshot; UI must declare it stale.
  serverProcess.kill('SIGTERM');
  await page.getByRole('alert').waitFor({ timeout: 22000 });
  assert.match(await page.getByRole('alert').innerText(), /last successful snapshot/);
  assert.equal(await page.getByRole('button', { name: '↓ Export CSV' }).isEnabled(), false);
  assert.deepEqual(errors, []);
  console.log('PASS responsive layout, unavailable-data labeling, stale snapshot and no browser runtime errors');
} finally {
  await browser?.close(); await vite?.close();
  serverProcess.kill('SIGTERM');
  await rm(directory, { recursive: true, force: true });
}
