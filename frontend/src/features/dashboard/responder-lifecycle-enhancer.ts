import { authSession } from '../auth/auth-session';
import { citizenSafetyApi, type EmergencyRecord, type EmergencyStatus } from './api/citizen-safety.api';

type SupportedLifecycleStatus = Extract<EmergencyStatus, 'submitted' | 'assigned' | 'en_route' | 'resolved'>;

const lifecycle: SupportedLifecycleStatus[] = ['submitted', 'assigned', 'en_route', 'resolved'];
let busy = false;
let lastSelectedId = '';
let refreshTimer: number | null = null;

function selectedIncidentId() {
  return document.querySelector<HTMLElement>('.ops-id-row > span')?.textContent?.trim() ?? '';
}

function isQueueVisible() {
  const pane = document.querySelector<HTMLElement>('.ops-detail-pane');
  return Boolean(pane && pane.offsetParent !== null);
}

function labelFor(status: SupportedLifecycleStatus) {
  if (status === 'submitted') return 'New request';
  if (status === 'assigned') return 'Responder assigned';
  if (status === 'en_route') return 'Responder en route';
  return 'Resolved';
}

function nextStatus(status: SupportedLifecycleStatus): SupportedLifecycleStatus | null {
  if (status === 'submitted') return 'assigned';
  if (status === 'assigned') return 'en_route';
  if (status === 'en_route') return 'resolved';
  return null;
}

function nextLabel(status: SupportedLifecycleStatus) {
  if (status === 'submitted') return 'Assign responder';
  if (status === 'assigned') return 'Mark en route';
  if (status === 'en_route') return 'Resolve incident';
  return 'Incident complete';
}

function guidance(status: SupportedLifecycleStatus, responderName?: string | null) {
  if (status === 'submitted') return 'No responder is assigned yet. Assigning this incident updates the citizen tracking screen on its next sync.';
  if (status === 'assigned') return `${responderName || 'The responder'} is assigned. Confirm dispatch before marking the unit en route.`;
  if (status === 'en_route') return `${responderName || 'The responder'} is traveling to the citizen. Resolve only after the response is complete.`;
  return 'This incident is closed. The citizen tracking screen will show Response complete.';
}

function toast(message: string, tone: 'ok' | 'error' = 'ok') {
  document.querySelector('[data-lifecycle-toast]')?.remove();
  const node = document.createElement('div');
  node.dataset.lifecycleToast = 'true';
  node.className = `lifecycle-toast ${tone}`;
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 2800);
}

async function transition(record: EmergencyRecord) {
  if (busy) return;
  const current = record.status as SupportedLifecycleStatus;
  const target = nextStatus(current);
  if (!target) return;

  busy = true;
  render(record, true);
  try {
    const session = authSession.get();
    const responderName = session?.user.name || record.responder_name || 'Demo E-Worker';
    const responderId = session?.user.id || record.responder_id || 'worker-demo';
    const payload = target === 'assigned'
      ? { status: target, responder_id: responderId, responder_name: responderName }
      : { status: target, responder_id: record.responder_id || responderId, responder_name: record.responder_name || responderName };

    const updated = await citizenSafetyApi.updateEmergency(record.id, payload);
    window.dispatchEvent(new CustomEvent('jalrakshak:emergency-updated', { detail: updated }));
    toast(target === 'assigned' ? 'Responder assigned — citizen tracking will update.' : target === 'en_route' ? 'Responder marked en route.' : 'Incident resolved.');
    render(updated, false);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Unable to update incident', 'error');
    render(record, false);
  } finally {
    busy = false;
  }
}

function render(record: EmergencyRecord, pending = false) {
  if (!isQueueVisible()) return;
  const detailPane = document.querySelector<HTMLElement>('.ops-detail-pane');
  if (!detailPane) return;

  let panel = detailPane.querySelector<HTMLElement>('[data-responder-lifecycle]');
  if (!panel) {
    panel = document.createElement('section');
    panel.dataset.responderLifecycle = 'true';
    panel.className = 'responder-lifecycle';
    const context = detailPane.querySelector<HTMLElement>('[data-command-center-context]');
    if (context) context.insertAdjacentElement('afterend', panel);
    else detailPane.querySelector('.ops-detail-header')?.insertAdjacentElement('afterend', panel);
  }

  const status = record.status as SupportedLifecycleStatus;
  if (!lifecycle.includes(status)) {
    panel.innerHTML = '<strong>Lifecycle unavailable</strong><span>This incident is outside the active response workflow.</span>';
    return;
  }

  const currentIndex = lifecycle.indexOf(status);
  const target = nextStatus(status);
  panel.innerHTML = `
    <div class="lifecycle-head">
      <div><span>LIVE RESPONSE LIFECYCLE</span><strong>${labelFor(status)}</strong></div>
      <em class="status-${status}">${status.replace('_', ' ').toUpperCase()}</em>
    </div>
    <div class="lifecycle-track">
      ${lifecycle.map((step, index) => `<div class="${index < currentIndex ? 'done' : index === currentIndex ? 'current' : ''}"><i>${index <= currentIndex ? '✓' : ''}</i><span>${labelFor(step)}</span></div>`).join('')}
    </div>
    <div class="lifecycle-action-row">
      <p>${guidance(status, record.responder_name)}</p>
      <button type="button" data-lifecycle-next ${!target || pending ? 'disabled' : ''}>${pending ? 'UPDATING…' : nextLabel(status)}</button>
    </div>
    <small>Backend status is the source of truth. Citizen tracking polls the same emergency record every 3 seconds.</small>`;

  panel.querySelector<HTMLButtonElement>('[data-lifecycle-next]')?.addEventListener('click', () => void transition(record));
}

async function syncSelected() {
  if (!isQueueVisible() || busy) return;
  const id = selectedIncidentId();
  if (!id) {
    document.querySelector('[data-responder-lifecycle]')?.remove();
    lastSelectedId = '';
    return;
  }
  try {
    const record = await citizenSafetyApi.getEmergency(id);
    lastSelectedId = id;
    render(record);
  } catch {
    // Keep the existing responder UI usable if lifecycle sync is temporarily unavailable.
  }
}

function scheduleSync() {
  if (refreshTimer != null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void syncSelected(), 120);
}

const observer = new MutationObserver(() => {
  const id = selectedIncidentId();
  if (id !== lastSelectedId || !document.querySelector('[data-responder-lifecycle]')) scheduleSync();
});

function start() {
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.ops-queue-list > button')) scheduleSync();
  });
  window.addEventListener('jalrakshak:emergency-updated', scheduleSync);
  window.setInterval(() => void syncSelected(), 3000);
  scheduleSync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
