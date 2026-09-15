import { citizenSafetyApi, type EvacuationRoute } from './api/citizen-safety.api';
import { hazardsApi, type HazardKind, type HazardReport, type HazardSubmission } from './api/hazards.api';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
let activePreviewUrl: string | null = null;
let selectedFile: File | null = null;
let pendingKind: HazardKind = 'road_blocked';
let latestKnownRoute: EvacuationRoute | null = null;
let submitting = false;
let submissionId = '';
let retryPayload: HazardSubmission | null = null;

const labels: Record<HazardKind, string> = {
  road_blocked: 'Road blocked',
  flooded_road: 'Flooded road',
  debris: 'Debris / obstruction',
  other: 'Other hazard',
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function getPosition(): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
    enableHighAccuracy: true,
    timeout: 7000,
    maximumAge: 10_000,
  }));
}

function encodePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Unable to read the photo. Select it again.'));
    reader.readAsDataURL(file);
  });
}

function clickSidebarNav(label: string) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.figma-nav button'));
  const target = buttons.find((button) => button.textContent?.replace(/\s+/g, ' ').trim().includes(label));
  target?.click();
}

function messagesBox() {
  return document.querySelector<HTMLElement>('#jalrakshak-navcat-overlay .ai-messages');
}

function appendStatus(html: string) {
  const box = messagesBox();
  if (!box) return;
  const card = document.createElement('div');
  card.className = 'navcat-hazard-chat-card';
  card.innerHTML = html;
  box.appendChild(card);
  box.scrollTop = box.scrollHeight;
  card.querySelector<HTMLButtonElement>('[data-open-hazard-route]')?.addEventListener('click', () => clickSidebarNav('Live Map'));
}

function routeSummary(route: EvacuationRoute) {
  const km = route.distance_m >= 1000 ? `${(route.distance_m / 1000).toFixed(1)} km` : `${Math.round(route.distance_m)} m`;
  const min = Math.max(1, Math.round(route.duration_s / 60));
  return `${escapeHtml(route.destination_name)} · about ${min} min · ${km}`;
}

function routeFingerprint(route: EvacuationRoute | null) {
  if (!route) return '';
  const geometry = route.geometry ?? [];
  const start = geometry[0]?.join(',') ?? '';
  const end = geometry[geometry.length - 1]?.join(',') ?? '';
  const middle = geometry[Math.floor(geometry.length / 2)]?.join(',') ?? '';
  return `${route.destination_name}|${Math.round(route.distance_m)}|${start}|${middle}|${end}`;
}

function cleanupPicker() {
  document.querySelector('.navcat-hazard-picker')?.remove();
  selectedFile = null;
  if (activePreviewUrl) URL.revokeObjectURL(activePreviewUrl);
  activePreviewUrl = null;
}

async function submitReport() {
  if (!selectedFile || submitting) return;
  submitting = true;
  const panel = document.querySelector('.navcat-hazard-picker');
  panel?.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach(item => item.disabled = true);
  const file = selectedFile;
  const previousRoute = latestKnownRoute;
  let report: HazardReport;
  try {
    if (!retryPayload) {
      const kind = pendingKind;
      const attachPhoto = panel?.querySelector<HTMLInputElement>('[data-share-hazard-photo]')?.checked;
      const position = await getPosition();
      if (!position) throw new Error('Allow location access to place this report at your current GPS position.');
      retryPayload = {
        client_request_id: submissionId, kind,
        latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy_m: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
        ...(attachPhoto ? { photo_base64: await encodePhoto(file) } : {}),
      };
    }
    report = await hazardsApi.create(retryPayload);
  } catch (error) {
    appendStatus(`<strong>Report not confirmed saved.</strong><p>${escapeHtml(error instanceof Error ? error.message : 'The backend is unavailable.')} Retry this submission to avoid duplicates.</p>`);
    submitting = false;
    panel?.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach(item => item.disabled = false);
    return;
  }
  cleanupPicker();
  submitting = false;
  window.dispatchEvent(new CustomEvent('jalrakshak:user-hazard-report', { detail: report }));
  appendStatus(`<div class="navcat-hazard-source">USER REPORTED · SHARED</div><strong>${escapeHtml(report.label)} saved to the backend.</strong><p>Citizen and responder route screens now use this report. ${report.has_photo ? 'The photo is available to you and responders.' : 'No photo was uploaded.'} I’m checking road alternatives; this report is not an official closure confirmation.</p>`);

  try {
    const route = await citizenSafetyApi.getEvacuationRoute(report.latitude, report.longitude);
    latestKnownRoute = route;
    window.dispatchEvent(new CustomEvent('jalrakshak:navcat-hazard-route', { detail: { report, route } }));

    if (route.screening_status !== 'complete') throw new Error('Shared hazard screening unavailable.');

    if (route.screening_status === 'complete' && route.recommended_count === 0) {
      appendStatus(`<div class="navcat-hazard-source danger">NO ROUTE RECOMMENDED</div><strong>I could not find a road option that clears the current safety screen.</strong><p>${route.alternatives_considered} route${route.alternatives_considered === 1 ? '' : 's'} checked · ${route.rejected_count ?? route.alternatives_considered} rejected. I will not tell you to use a route that the current screen rejected. Open the map to review the situation or request emergency help if you cannot safely move.</p><button type="button" data-open-hazard-route>Open Live Map</button>`);
      return;
    }

    const routeChanged = Boolean(previousRoute) && routeFingerprint(previousRoute) !== routeFingerprint(route);
    const rejected = route.rejected_count ?? 0;
    const viable = route.viable_count ?? Math.max(1, route.alternatives_considered - rejected);
    appendStatus(`<div class="navcat-hazard-source">${routeChanged ? 'ROUTE CHANGED' : 'ROUTE REFRESHED'}</div><strong>${routeSummary(route)}</strong><p>${routeChanged ? `Your recommended path changed after the report. ` : ''}${route.alternatives_considered} route${route.alternatives_considered === 1 ? '' : 's'} checked · ${rejected} rejected · ${viable} viable. JalRakshak is now showing the safest remaining viable option from the current prototype screen. The blockage remains USER REPORTED until verified.</p><button type="button" data-open-hazard-route>Open Live Map</button>`);
  } catch {
    appendStatus('<strong>I saved the blockage report, but live routing did not respond.</strong><p>Your report is still marked USER REPORTED. I will not claim a new route is safe until routing returns a result.</p><button type="button" data-open-hazard-route>Open Live Map</button>');
  }
}

function showPicker(file: File) {
  if (submitting) return;
  cleanupPicker();
  submissionId = crypto.randomUUID();
  retryPayload = null;
  selectedFile = file;
  activePreviewUrl = URL.createObjectURL(file);
  const overlay = document.getElementById('jalrakshak-navcat-overlay');
  if (!overlay) return;

  const panel = document.createElement('section');
  panel.className = 'navcat-hazard-picker';
  panel.innerHTML = `
    <div class="navcat-hazard-preview"><img src="${activePreviewUrl}" alt="Selected hazard report" /></div>
    <div class="navcat-hazard-picker-copy">
      <div class="navcat-hazard-source">ATTACH TO SAFETY REPORT</div>
      <strong>What does this photo show?</strong>
      <p>Your current GPS and hazard type will be shared with signed-in citizens and responders. Reports stay active until a responder resolves them.</p>
      <label><input type="checkbox" data-share-hazard-photo /> Also upload this photo for responder review (optional).</label>
      <div class="navcat-hazard-types">
        ${Object.entries(labels).map(([key, label]) => `<button type="button" data-hazard-kind="${key}" class="${key === pendingKind ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      <div class="navcat-hazard-actions"><button type="button" data-hazard-cancel>Cancel</button><button type="button" class="primary" data-hazard-submit>Report + recalculate</button></div>
    </div>`;

  overlay.appendChild(panel);
  panel.querySelectorAll<HTMLButtonElement>('[data-hazard-kind]').forEach((button) => button.addEventListener('click', () => {
    pendingKind = (button.dataset.hazardKind as HazardKind) || 'road_blocked';
    retryPayload = null;
    submissionId = crypto.randomUUID();
    panel.querySelectorAll('[data-hazard-kind]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  }));
  panel.querySelector<HTMLButtonElement>('[data-hazard-cancel]')?.addEventListener('click', cleanupPicker);
  panel.querySelector<HTMLButtonElement>('[data-hazard-submit]')?.addEventListener('click', () => void submitReport());
  panel.querySelector('[data-share-hazard-photo]')?.addEventListener('change', () => {
    retryPayload = null;
    submissionId = crypto.randomUUID();
  });
}

function handleFile(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) {
    appendStatus('<strong>Unsupported image type.</strong><p>Please use JPEG, PNG, or WebP for safety reports.</p>');
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    appendStatus('<strong>That image is too large.</strong><p>Please choose an image smaller than 8 MB.</p>');
    return;
  }
  showPicker(file);
}

function enhanceComposer() {
  const row = document.querySelector<HTMLElement>('#jalrakshak-navcat-overlay .ai-input-row');
  if (!row || row.querySelector('[data-navcat-attach]')) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.className = 'navcat-hazard-file-input';
  input.setAttribute('aria-hidden', 'true');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'navcat-attach-button';
  button.dataset.navcatAttach = 'true';
  button.title = 'Attach a road or flood photo';
  button.setAttribute('aria-label', 'Attach hazard photo');
  button.textContent = '📎';

  const voice = row.querySelector('[data-ai-mic]');
  if (voice) row.insertBefore(button, voice);
  else row.prepend(button);
  row.appendChild(input);

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) handleFile(file);
  });
}

window.addEventListener('jalrakshak:route-analysis', (event) => {
  const route = (event as CustomEvent<EvacuationRoute>).detail;
  if (route) latestKnownRoute = route;
});

const observer = new MutationObserver(() => enhanceComposer());
observer.observe(document.body, { childList: true, subtree: true });
enhanceComposer();
