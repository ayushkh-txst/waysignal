import { citizenSafetyApi, type EmergencyListFilters, type EmergencyRecord } from './api/citizen-safety.api';

type FilterKey = 'all' | 'new' | 'assigned' | 'en_route' | 'resolved' | 'live' | 'demo';

const FILTER_SELECTOR = '[data-command-center-filters] [data-incident-filter]';
const CARD_SELECTOR = '.ops-queue-list > button';

let activeFilter: FilterKey = 'all';
let allRecords: EmergencyRecord[] = [];
let filteredRecords: EmergencyRecord[] = [];
let loading = false;
let applying = false;

function onResponder() { return window.location.pathname.includes('/responder'); }
function filterToApi(key: FilterKey): EmergencyListFilters | undefined {
  if (key === 'new') return { status: 'submitted' };
  if (key === 'assigned') return { status: 'assigned' };
  if (key === 'en_route') return { status: 'en_route' };
  if (key === 'resolved') return { status: 'resolved' };
  if (key === 'live') return { is_demo: false };
  if (key === 'demo') return { is_demo: true };
  return undefined;
}
function matches(record: EmergencyRecord, key: FilterKey) {
  if (record.status === 'cancelled') return false;
  if (key === 'all') return true;
  if (key === 'new') return record.status === 'submitted';
  if (key === 'assigned') return record.status === 'assigned';
  if (key === 'en_route') return record.status === 'en_route';
  if (key === 'resolved') return record.status === 'resolved';
  if (key === 'live') return !record.is_demo;
  return Boolean(record.is_demo);
}
function cardId(card: HTMLElement) { return card.querySelector<HTMLElement>('.queue-top > span')?.textContent?.trim() || ''; }
function countFor(key: FilterKey) { return allRecords.filter((record) => matches(record, key)).length; }

function decorateFilters() {
  const host = document.querySelector<HTMLElement>('[data-command-center-filters]');
  if (!host) return;
  host.classList.add('incident-filter-grid');
  host.querySelectorAll<HTMLButtonElement>('[data-incident-filter]').forEach((button) => {
    const key = (button.dataset.incidentFilter || 'all') as FilterKey;
    button.disabled = false;
    button.removeAttribute('disabled');
    button.style.pointerEvents = 'auto';
    button.classList.toggle('active', key === activeFilter);
    button.setAttribute('aria-pressed', String(key === activeFilter));
    const badge = button.querySelector<HTMLElement>('b');
    if (badge) badge.textContent = String(countFor(key));
    button.classList.toggle('incident-filter-full-row', key === 'demo');
  });
}
function renderEmpty(list: HTMLElement, message: string) {
  let empty = list.querySelector<HTMLElement>('[data-queue-filter-empty-v3]');
  if (!empty) { empty = document.createElement('div'); empty.dataset.queueFilterEmptyV3 = 'true'; empty.className = 'queue-filter-empty-v3'; list.appendChild(empty); }
  empty.textContent = message;
}
function clearEmpty(list: HTMLElement) { list.querySelector<HTMLElement>('[data-queue-filter-empty-v3]')?.remove(); }

function applyRecords(records: EmergencyRecord[]) {
  if (applying) return;
  applying = true;
  try {
    const list = document.querySelector<HTMLElement>('.ops-queue-list');
    if (!list) return;
    const allowed = new Set(records.filter((r) => matches(r, activeFilter)).map((r) => r.id));
    const cards = Array.from(document.querySelectorAll<HTMLButtonElement>(CARD_SELECTOR));
    let firstVisible: HTMLButtonElement | null = null;
    let visible = 0;
    for (const card of cards) {
      const show = allowed.has(cardId(card));
      if (show) {
        card.style.removeProperty('display');
        card.style.pointerEvents = 'auto';
        visible += 1;
        if (!firstVisible) firstVisible = card;
      } else {
        card.style.setProperty('display', 'none', 'important');
        card.style.pointerEvents = 'none';
      }
    }
    if (!visible) renderEmpty(list, `No ${activeFilter === 'all' ? '' : activeFilter.replace('_',' ') + ' '}incidents right now.`);
    else clearEmpty(list);
    const selected = cards.find((card) => card.classList.contains('active'));
    if (selected && selected.style.display === 'none') firstVisible?.click();
  } finally { applying = false; }
}
async function loadAllRecords() {
  try { allRecords = (await citizenSafetyApi.listEmergencies()).filter((r) => r.status !== 'cancelled'); } catch {}
  decorateFilters();
}
async function loadFilteredRecords(key: FilterKey) {
  if (loading) return;
  loading = true;
  try {
    const serverRecords = await citizenSafetyApi.listEmergencies(filterToApi(key));
    filteredRecords = serverRecords.filter((r) => matches(r, key));
  } catch {
    if (!allRecords.length) { try { allRecords = await citizenSafetyApi.listEmergencies(); } catch { allRecords = []; } }
    filteredRecords = allRecords.filter((r) => matches(r, key));
  } finally { loading = false; }
  applyRecords(filteredRecords);
  decorateFilters();
}
async function activateFilter(key: FilterKey) {
  activeFilter = key;
  decorateFilters();
  await loadFilteredRecords(key);
}

// Bind directly to the rendered buttons. This avoids capture-phase conflicts with older enhancers.
function bindFilterButtons() {
  decorateFilters();
  document.querySelectorAll<HTMLButtonElement>(FILTER_SELECTOR).forEach((button) => {
    if (button.dataset.finalFilterBound === 'true') return;
    button.dataset.finalFilterBound = 'true';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = (button.dataset.incidentFilter || 'all') as FilterKey;
      void activateFilter(key);
    });
  });
}
let mutationTimer = 0;
function scheduleRefresh() {
  window.clearTimeout(mutationTimer);
  mutationTimer = window.setTimeout(() => {
    bindFilterButtons();
    const source = filteredRecords.length || activeFilter !== 'all' ? filteredRecords : allRecords;
    applyRecords(source.filter((r) => matches(r, activeFilter)));
  }, 60);
}
async function start() {
  if (!onResponder()) return;
  await loadAllRecords();
  filteredRecords = allRecords.filter((r) => matches(r, activeFilter));
  applyRecords(filteredRecords);
  bindFilterButtons();
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setInterval(async () => { await loadAllRecords(); await loadFilteredRecords(activeFilter); bindFilterButtons(); }, 5000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else void start();
