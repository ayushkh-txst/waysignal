import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { authSession } from '../src/features/auth/auth-session';

test('existing picker submits once, retries safely, and shares a photo only with opt-in', async () => {
  const dom = new JSDOM('<body><div id="jalrakshak-navcat-overlay"><div class="ai-messages"></div><div class="ai-input-row"></div></div></body>', { url: 'http://localhost' });
  const win = dom.window;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    geolocation: { getCurrentPosition: (success: Function) => success({ coords: { latitude: 30.05, longitude: -97, accuracy: 10 } }) },
  } });
  Object.assign(globalThis, { window: win, document: win.document,
    MutationObserver: win.MutationObserver, CustomEvent: win.CustomEvent, FileReader: win.FileReader });
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:test-photo'; URL.revokeObjectURL = () => {};
  authSession.set({ access_token: 'test-token', token_type: 'bearer', expires_in: 900,
    user: { id: 'citizen', role: 'citizen', name: 'Test', email: 'test@example.com' } });
  let posts: any[] = [];
  let accept = false;
  let reports: any[] = [];
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); posts.push(body);
      if (!accept) return new Response(JSON.stringify({ detail: 'Test save failed' }), { status: 503 });
      const saved = { ...body, id: 'HAZ-server-id', label: 'Road blocked', source: 'user_reported',
        status: 'active', updated_at: '2026-01-01T00:00:00Z', has_photo: Boolean(body.photo_base64) };
      reports = [saved]; return new Response(JSON.stringify(saved), { status: 201 });
    }
    if (String(url).includes('/hazards')) return new Response(JSON.stringify(reports));
    return new Response(JSON.stringify({ detail: 'Routing intentionally offline in this test' }), { status: 503 });
  };
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  try {
    await import('../src/features/dashboard/navcat-hazard-report-enhancer');
    const input = document.querySelector<HTMLInputElement>('.navcat-hazard-file-input')!;
    const choose = () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [new win.File(['photo-bytes'], 'road.png', { type: 'image/png' })] });
      input.dispatchEvent(new win.Event('change'));
    };
    choose();
    const submit = document.querySelector<HTMLButtonElement>('[data-hazard-submit]')!;
    submit.click(); submit.click();
    await settle();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].photo_base64, undefined);
    assert.match(document.body.textContent!, /Report not confirmed saved/);
    assert.ok(document.querySelector('.navcat-hazard-picker'));
    assert.equal(submit.disabled, false);
    accept = true;
    submit.click(); await settle();
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0], posts[1]);
    assert.equal(document.querySelector('.navcat-hazard-picker'), null);
    assert.match(document.body.textContent!, /saved to the backend/);
    assert.match(document.body.textContent!, /No photo was uploaded/);
    assert.match(document.body.textContent!, /live routing did not respond/);
    choose();
    document.querySelector<HTMLInputElement>('[data-share-hazard-photo]')!.checked = true;
    document.querySelector<HTMLButtonElement>('[data-hazard-submit]')!.click();
    await settle();
    assert.equal(posts.length, 3);
    assert.equal(posts[2].photo_base64, Buffer.from('photo-bytes').toString('base64'));
    assert.equal(document.querySelectorAll('[data-navcat-attach]').length, 1);
  } finally {
    URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
    dom.window.close();
  }
});
