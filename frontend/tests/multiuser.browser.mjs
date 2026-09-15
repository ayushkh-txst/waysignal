// Five isolated browser sessions; real login/SOS/admin APIs and SQLite.
// Build first: VITE_API_BASE_URL=/api/v1 npm run build
// TEST_PYTHON=/path/to/python CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/multiuser.browser.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const appUrl = 'http://127.0.0.1:8016';
const temp = await mkdtemp(join(tmpdir(), 'gone-multiuser-'));
// These passwords exist only in this isolated test process.
const accounts = [
  ['citizen@example.com', 'FixtureCitizenOne!26', 'citizen-demo', 'citizen', 'DEMO_CITIZEN_PASSWORD'],
  ['citizen2@example.com', 'FixtureCitizenTwo!26', 'citizen-demo-2', 'citizen', 'DEMO_CITIZEN_2_PASSWORD'],
  ['citizen3@example.com', 'FixtureCitizenThree!26', 'citizen-demo-3', 'citizen', 'DEMO_CITIZEN_3_PASSWORD'],
  ['worker@example.com', 'FixtureAdminOne!26', 'worker-demo', 'worker', 'DEMO_WORKER_PASSWORD'],
  ['worker2@example.com', 'FixtureAdminTwo!26', 'worker-demo-2', 'worker', 'DEMO_WORKER_2_PASSWORD'],
];
const backend = spawn(process.env.TEST_PYTHON || 'python3', ['-c', `
import uvicorn
from app.main import app
from app.services import dispatch_contacts
async def location(lat, lon):
    return dict(label='Houston test road', country='US', city='Houston', region='Texas', source='Test geocoder fixture')
dispatch_contacts.resolve_location = location
uvicorn.run(app, host='127.0.0.1', port=8016, log_level='error')
`], {cwd: resolve('../backend'), env: {...process.env,
  ...Object.fromEntries(accounts.map(a => [a[4], a[1]])),
  DEMO_CITIZEN_EMAIL: accounts[0][0], DEMO_WORKER_EMAIL: accounts[3][0],
  JWT_SECRET: 'multiuser-browser-test-secret-0123456789',
  DATABASE_URL: `sqlite:///${join(temp, 'accounts.db')}`,
  FRONTEND_DIST: resolve('dist'), FRONTEND_ORIGIN: appUrl, ENVIRONMENT: 'production',
  OPENAI_API_KEY: '', DISPATCH_AI_MODEL: '',
}, stdio: ['ignore', 'pipe', 'pipe']});
let logs = '', browser;
backend.stdout.on('data', x => logs += x); backend.stderr.on('data', x => logs += x);
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (backend.exitCode !== null) throw Error(logs);
    try { if ((await fetch(appUrl + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'Test backend did not start');
  browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath: process.env.CHROMIUM_EXECUTABLE_PATH} : {})});
  const errors = [], sessions = [];
  for (const account of accounts) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {
      getCurrentPosition: ok => ok({coords: {latitude: 29.7179, longitude: -95.402, accuracy: 14}}),
      watchPosition: () => 1, clearWatch: () => {},
    }}));
    await page.route('**/api/v1/safety/context?**', route => route.fulfill({json: {
      latitude: 29.7179, longitude: -95.402, observed_at: new Date().toISOString(), source: 'Test weather fixture',
      temperature_c: 22, precipitation_next_6h_mm: 0, precipitation_probability_max_6h: 0,
      river_discharge_m3s: null, river_discharge_tomorrow_m3s: null, river_trend_percent: null,
      prototype_risk_score: 20, prototype_risk_level: 'low',
    }}));
    await page.goto(appUrl);
    assert.equal(await page.getByText('Choose a role, then sign in', {exact: true}).count(), 0);
    await page.locator('input[type=email]').fill(account[0]);
    await page.locator('input[type=password]').fill(account[1]);
    const response = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.request().method() === 'POST');
    await page.locator('button[type=submit]').click();
    const result = await response;
    assert.equal(result.status(), 200);
    const body = await result.json(); assert.equal(body.user.id, account[2]);
    await page.waitForURL(account[3] === 'citizen' ? '**/citizen' : '**/responder');
    sessions.push({page, account, headers: {Authorization: `Bearer ${body.access_token}`}});
  }
  console.log('PASS all five independent browser sessions sign in to the correct dashboards');
  const citizens = sessions.slice(0, 3), admins = sessions.slice(3);
  for (const {page} of admins) {
    await page.locator('[data-worker-nav=queue]').click();
    await page.locator('[data-incident-filter=live]').click();
  }
  for (const [i, session] of citizens.entries()) {
    const {page} = session;
    await page.getByRole('button', {name: 'View Details', exact: true}).click();
    await page.locator('.figma-nav button').filter({hasText: 'Emergency Help'}).click();
    if (await page.locator('.emergency-launch').count()) await page.locator('.emergency-launch').click();
    await page.getByRole('button', {name: /Use my location/}).click();
    await page.locator('.emergency-field textarea').fill(`Multi-account test citizen ${i + 1}`);
    const sent = page.waitForResponse(r => r.url().endsWith('/api/v1/emergencies') && r.request().method() === 'POST');
    await page.locator('.emergency-submit').click();
    const result = await sent; assert.equal(result.status(), 201);
    const record = await result.json(); assert.equal(record.citizen_id, session.account[2]); session.id = record.id;
    await page.locator('.tracking-request-meta').getByText(record.id, {exact: true}).waitFor();
  }
  for (const session of citizens) {
    const own = await (await fetch(appUrl + '/api/v1/emergencies', {headers: session.headers})).json();
    assert.deepEqual(own.map(r => r.id), [session.id]);
    for (const other of citizens.filter(c => c !== session)) {
      assert.equal((await fetch(appUrl + '/api/v1/emergencies/' + other.id, {headers: session.headers})).status, 404);
      assert.equal(await session.page.locator('.tracking-request-meta').getByText(other.id, {exact: true}).count(), 0);
    }
  }
  for (const {page} of admins) for (const citizen of citizens) {
    await page.locator('.ops-queue-list button').filter({hasText: citizen.id}).waitFor();
  }
  console.log('PASS three citizen form submissions remain isolated; both admins see all three requests');
  async function action(admin, id, button, status) {
    await admin.page.locator('.ops-queue-list button').filter({hasText: id}).click();
    const changed = admin.page.waitForResponse(r => r.url().endsWith('/emergencies/' + id) && r.request().method() === 'PATCH');
    await admin.page.getByRole('button', {name: button, exact: true}).click();
    const result = await changed; assert.equal(result.status(), 200);
    const body = await result.json(); assert.equal(body.status, status); return body;
  }
  for (let i = 0; i < 2; i++) {
    const assignedBy = admins[i], coordinatedBy = admins[1 - i], citizen = citizens[i];
    const assigned = await action(assignedBy, citizen.id, 'Assign Responder', 'assigned');
    assert.equal(assigned.responder_id, assignedBy.account[2]);
    // Wait for the other admin's real polling to observe assignment before clicking.
    await coordinatedBy.page.locator('.ops-queue-list button').filter({hasText: citizen.id}).click();
    await coordinatedBy.page.waitForFunction(() => [...document.querySelectorAll('.timeline-actions button')].some(b => b.textContent === 'Mark En Route' && !b.disabled));
    const enRoute = await action(coordinatedBy, citizen.id, 'Mark En Route', 'en_route');
    assert.equal(enRoute.responder_id, assignedBy.account[2], 'Status update must preserve assigned responder');
    await citizen.page.locator('.tracking-hero').getByRole('heading', {name: 'Help is on the way', exact: true}).waitFor();
    const resolved = await action(coordinatedBy, citizen.id, 'Resolve Incident', 'resolved');
    assert.equal(resolved.responder_id, assignedBy.account[2]);
    await citizen.page.locator('.tracking-hero').getByRole('heading', {name: 'Response complete', exact: true}).waitFor();
  }
  await citizens[2].page.locator('.tracking-hero').getByRole('heading', {name: 'Waiting for a responder', exact: true}).waitFor();
  for (const admin of admins) {
    const report = await (await fetch(appUrl + '/api/v1/admin/reports', {headers: admin.headers})).json();
    assert.equal(report.summary.total, 3); assert.equal(report.summary.resolved, 2);
  }
  assert.deepEqual(errors, []);
  console.log('PASS both admins assign and coordinate; original responder retained; correct citizens receive updates; Reports totals agree');
  console.log('Five-account functional check passed with FastAPI/SQLite and external weather/geocoder fixtures. This is not a load test or a hosted Render test.');
} finally {
  await browser?.close(); backend.kill('SIGTERM');
  await new Promise(r => backend.exitCode !== null ? r() : backend.once('exit', r));
  await rm(temp, {recursive: true, force: true});
}
