import { citizenSafetyApi, type EmergencyRecord } from './api/citizen-safety.api';

let records: EmergencyRecord[] = [];
let loading = false;
let registryQuery = '';
let registryStatus = 'all';
let registrySource = 'all';
let selectedRegistryId = '';

const isResponderPage = () => window.location.pathname.includes('/responder');
const actionable = (r: EmergencyRecord) => ['submitted', 'assigned', 'en_route'].includes(r.status);

function escapeHtml(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function statusLabel(status: string) {
  if (status === 'submitted') return 'NEW';
  if (status === 'assigned') return 'ASSIGNED';
  if (status === 'en_route') return 'EN ROUTE';
  if (status === 'resolved') return 'RESOLVED';
  return status.toUpperCase();
}
function typeLabel(type: string) {
  if (type === 'rescue') return 'Trapped Response';
  if (type === 'medical') return 'Medical Response';
  return 'Evacuation Response';
}
function timeAgo(iso: string) {
  const elapsed = Math.max(0, Date.now() - Date.parse(iso));
  const min = Math.floor(elapsed / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
function shell() { return document.querySelector<HTMLElement>('.ops-shell'); }
function setActiveNav(label: string) {
  document.querySelectorAll<HTMLButtonElement>('.ops-nav button').forEach((button) => button.classList.toggle('active', button.querySelector('span')?.textContent?.trim() === label));
}
function hideOperationalPanels() {
  document.querySelectorAll<HTMLElement>('.ops-queue-pane,.ops-detail-pane,.ops-map-page').forEach((el) => { el.style.display = 'none'; });
  document.querySelectorAll<HTMLElement>('.command-center-static-view').forEach((el) => { if (!el.dataset.incidentRegistryV2) el.remove(); });
}
function showOperationalPanels() {
  document.querySelector<HTMLElement>('[data-incident-registry-v2]')?.remove();
  const queue = document.querySelector<HTMLElement>('.ops-queue-pane');
  const detail = document.querySelector<HTMLElement>('.ops-detail-pane');
  if (queue) queue.style.display = '';
  if (detail) detail.style.display = '';
  setActiveNav('Incident Queue');
  enforceActionableQueue();
}
async function refreshRecords() {
  if (loading) return;
  loading = true;
  try { records = (await citizenSafetyApi.listEmergencies()).filter((r) => r.status !== 'cancelled'); } catch {} finally { loading = false; }
}
function registryFiltered() {
  const q = registryQuery.trim().toLowerCase();
  return records
    .filter((r) => registryStatus === 'all' || r.status === registryStatus)
    .filter((r) => registrySource === 'all' || (registrySource === 'live' ? !r.is_demo : Boolean(r.is_demo)))
    .filter((r) => !q || [r.id, r.citizen_name, r.emergency_type, r.status, r.notes].join(' ').toLowerCase().includes(q))
    .sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at));
}
function stageDone(r: EmergencyRecord, stage: 'received'|'assigned'|'en_route'|'resolved') {
  const order = { submitted: 1, assigned: 2, en_route: 3, resolved: 4, cancelled: 0 } as const;
  const needed = { received: 1, assigned: 2, en_route: 3, resolved: 4 }[stage];
  return (order[r.status] || 0) >= needed;
}
function detailMarkup(r: EmergencyRecord) {
  const risk = r.risk_score ?? '—';
  const responder = r.responder_name || 'Unassigned';
  return `<section class="registry-detail-workspace">
    <header class="registry-detail-header">
      <div><div class="registry-detail-kicker">${escapeHtml(r.id)} <span class="registry-type ${escapeHtml(r.emergency_type)}">${typeLabel(r.emergency_type)}</span></div><h2>${escapeHtml(r.citizen_name)}</h2><p>${r.is_demo ? 'Demo incident' : 'Live citizen SOS'} · ${Number(r.people_count || 1)} ${Number(r.people_count || 1) === 1 ? 'person' : 'people'} · ${timeAgo(r.created_at)}</p></div>
      <div class="registry-detail-actions">${actionable(r) ? `<button data-open-queue-id="${escapeHtml(r.id)}">Open in Incident Queue</button>` : `<span class="registry-record-complete">Resolved record</span>`}<button data-registry-map="${escapeHtml(r.id)}">View on Map</button></div>
    </header>
    <div class="registry-detail-grid">
      <article class="registry-timeline-card"><span class="registry-card-label">RESPONSE TIMELINE</span>
        ${[['received','Received','Request entered queue'],['assigned','Assigned',responder],['en_route','En Route','Responder traveling'],['resolved','Resolved','Incident closed']].map(([key,label,sub]) => `<div class="registry-stage ${stageDone(r,key as any) ? 'done' : ''}"><i>${stageDone(r,key as any) ? '✓' : ''}</i><div><strong>${label}</strong><small>${escapeHtml(sub)}</small></div></div>`).join('')}
      </article>
      <div class="registry-side-stack">
        <article class="registry-responder-card"><span class="registry-card-label">ASSIGNED RESPONDER</span><div class="registry-responder-row"><b>${escapeHtml((responder || 'U').slice(0,2).toUpperCase())}</b><div><strong>${escapeHtml(responder)}</strong><small>${r.status === 'en_route' ? 'En route' : r.status === 'resolved' ? 'Response complete' : actionable(r) ? 'Operational record' : 'Unassigned'}</small></div></div></article>
        <article class="registry-ai-card"><span class="registry-card-label">AI GUIDANCE</span><p>${actionable(r) ? 'Review live GPS, risk context, route conditions, and responder availability before dispatch decisions.' : 'This response is complete. Review the incident history and citizen notes for after-action follow-up.'}</p><p><strong>Citizen note:</strong> ${escapeHtml(r.notes || 'No note provided.')}</p></article>
        <article class="registry-metric-card"><div><span>RISK SCORE</span><strong>${escapeHtml(risk)}/100</strong></div><div><span>GPS ACCURACY</span><strong>${r.accuracy_m ? `±${Math.round(r.accuracy_m)}m` : '—'}</strong></div><div><span>RAIN NEXT 6H</span><strong>${r.precipitation_next_6h_mm ?? '—'} mm</strong></div><div><span>LOCATION</span><strong>${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}</strong></div></article>
      </div>
    </div>
  </section>`;
}
function registryMarkup() {
  const filtered = registryFiltered();
  if (!selectedRegistryId || !filtered.some((r) => r.id === selectedRegistryId)) selectedRegistryId = filtered[0]?.id || '';
  const selected = records.find((r) => r.id === selectedRegistryId) || filtered[0];
  return `<header class="incident-registry-header"><div><span class="incident-registry-eyebrow">ALL INCIDENTS</span><h1>All requests</h1><p>Every incident can be inspected here. Incident Queue is only for active operational work.</p></div><button type="button" data-open-active-queue>Open Incident Queue →</button></header>
  <section class="incident-registry-toolbar"><label class="incident-registry-search"><span>⌕</span><input data-registry-search value="${escapeHtml(registryQuery)}" placeholder="Search ID, citizen, type, notes…" /></label><div class="incident-registry-filter-group">${[['all','All'],['submitted','New'],['assigned','Assigned'],['en_route','En Route'],['resolved','Resolved']].map(([k,l]) => `<button data-registry-status="${k}" class="${registryStatus===k?'active':''}">${l}</button>`).join('')}</div><div class="incident-registry-filter-group compact">${[['all','All sources'],['live','Live'],['demo','Demo']].map(([k,l]) => `<button data-registry-source="${k}" class="${registrySource===k?'active':''}">${l}</button>`).join('')}</div></section>
  <section class="registry-master-detail"><aside class="registry-master-list">${filtered.length ? filtered.map((r) => `<button class="registry-master-item ${r.id===selectedRegistryId?'active':''}" data-registry-select="${escapeHtml(r.id)}"><div><span>${escapeHtml(r.id)}</span><em class="registry-status ${escapeHtml(r.status)}">${statusLabel(r.status)}</em></div><strong>${escapeHtml(r.citizen_name)}</strong><small>${typeLabel(r.emergency_type)} · ${Number(r.people_count||1)} ${Number(r.people_count||1)===1?'person':'people'} · ${timeAgo(r.updated_at||r.created_at)}</small></button>`).join('') : '<div class="incident-registry-empty">No incidents match these filters.</div>'}</aside><div class="registry-master-detail-pane">${selected ? detailMarkup(selected) : '<div class="incident-registry-empty">Select an incident to inspect.</div>'}</div></section>`;
}
function wireRegistry(view: HTMLElement) {
  view.querySelector<HTMLButtonElement>('[data-open-active-queue]')?.addEventListener('click', () => openQueue());
  const search = view.querySelector<HTMLInputElement>('[data-registry-search]');
  search?.addEventListener('input', () => { registryQuery = search.value; renderRegistry(false); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-registry-search]')?.focus()); });
  view.querySelectorAll<HTMLButtonElement>('[data-registry-status]').forEach((b) => b.addEventListener('click', () => { registryStatus = b.dataset.registryStatus || 'all'; selectedRegistryId = ''; renderRegistry(false); }));
  view.querySelectorAll<HTMLButtonElement>('[data-registry-source]').forEach((b) => b.addEventListener('click', () => { registrySource = b.dataset.registrySource || 'all'; selectedRegistryId = ''; renderRegistry(false); }));
  view.querySelectorAll<HTMLButtonElement>('[data-registry-select]').forEach((b) => b.addEventListener('click', () => { selectedRegistryId = b.dataset.registrySelect || ''; renderRegistry(false); }));
  view.querySelectorAll<HTMLButtonElement>('[data-open-queue-id]').forEach((b) => b.addEventListener('click', () => openQueue(b.dataset.openQueueId || '')));
  view.querySelectorAll<HTMLButtonElement>('[data-registry-map]').forEach((b) => b.addEventListener('click', () => { const r = records.find((x) => x.id === b.dataset.registryMap); if (!r) return; sessionStorage.setItem('jalrakshak:selected-incident', JSON.stringify(r)); const mapButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.ops-nav button')).find((x) => x.querySelector('span')?.textContent?.trim() === 'Live Map'); mapButton?.click(); }));
}
async function renderRegistry(load = true) {
  if (!isResponderPage()) return;
  if (load) await refreshRecords();
  const root = shell(); if (!root) return;
  hideOperationalPanels();
  let view = root.querySelector<HTMLElement>('[data-incident-registry-v2]');
  if (!view) { view = document.createElement('section'); view.dataset.incidentRegistryV2 = 'true'; view.className = 'command-center-static-view incident-registry-v2'; root.appendChild(view); }
  view.innerHTML = registryMarkup(); setActiveNav('All Incidents'); wireRegistry(view);
}
function findQueueCard(id: string) { return Array.from(document.querySelectorAll<HTMLButtonElement>('.ops-queue-list > button')).find((card) => card.querySelector('.queue-top > span')?.textContent?.trim() === id) ?? null; }
function enforceActionableQueue() {
  if (!isResponderPage() || document.querySelector('[data-incident-registry-v2]')) return;
  const byId = new Map(records.map((r) => [r.id, r]));
  const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('.ops-queue-list > button'));
  cards.forEach((card) => { const id = card.querySelector('.queue-top > span')?.textContent?.trim() || ''; const record = byId.get(id); if (record) card.style.display = actionable(record) ? '' : 'none'; });
  document.querySelectorAll<HTMLButtonElement>('[data-incident-filter]').forEach((button) => { const key = button.dataset.incidentFilter; if (key === 'resolved') button.style.display = 'none'; if (key === 'all') { const badge = button.querySelector('b'); if (badge) badge.textContent = String(records.filter(actionable).length); } });
  const selectedId = document.querySelector<HTMLElement>('.ops-id-row > span')?.textContent?.trim() || '';
  const selected = byId.get(selectedId);
  if (selected && !actionable(selected)) { const first = records.find(actionable); findQueueCard(first?.id || '')?.click(); }
  const heading = document.querySelector<HTMLElement>('.ops-queue-pane header h2'); if (heading) heading.textContent = 'Active Response Queue';
  const subtitle = document.querySelector<HTMLElement>('.ops-queue-pane header span'); if (subtitle) subtitle.textContent = 'New · Assigned · En Route · auto-refresh 5s';
}
async function openQueue(preferredId = '') {
  await refreshRecords(); showOperationalPanels(); requestAnimationFrame(() => { enforceActionableQueue(); const targetId = preferredId && records.find((r) => r.id === preferredId && actionable(r)) ? preferredId : records.find(actionable)?.id || ''; findQueueCard(targetId)?.click(); });
}
function handleNavClick(event: Event) {
  const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.ops-nav button');
  const label = button?.querySelector('span')?.textContent?.trim();
  if (label === 'All Incidents') window.setTimeout(() => void renderRegistry(true), 0);
  else if (label === 'Incident Queue' || label === 'Emergency Queue') window.setTimeout(() => void openQueue(), 0);
  else if (label) document.querySelector<HTMLElement>('[data-incident-registry-v2]')?.remove();
}
function start() {
  if (!isResponderPage()) return;
  document.addEventListener('click', handleNavClick, true);
  void refreshRecords().then(() => enforceActionableQueue());
  window.setInterval(() => { void refreshRecords().then(() => { const registry = document.querySelector<HTMLElement>('[data-incident-registry-v2]'); if (registry) renderRegistry(false); else enforceActionableQueue(); }); }, 5000);
  new MutationObserver(() => { if (!document.querySelector('[data-incident-registry-v2]')) enforceActionableQueue(); }).observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
