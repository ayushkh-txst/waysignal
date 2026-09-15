import { citizenSafetyApi, type EmergencyRecord } from './api/citizen-safety.api';

let records: EmergencyRecord[] = [];
let busy = false;
let activeFilter = 'all';
let selecting = false;

const onResponder = () => window.location.pathname.includes('/responder');

async function refreshRecords() {
  if (busy) return;
  busy = true;
  try {
    records = (await citizenSafetyApi.listEmergencies()).filter((record) => record.status !== 'cancelled');
  } catch {
    // Keep the last successful snapshot if the API briefly fails.
  } finally {
    busy = false;
  }
}

function cardId(card: HTMLElement) {
  return card.querySelector<HTMLElement>('.queue-top > span')?.textContent?.trim() || '';
}

function matches(record: EmergencyRecord, filter: string) {
  if (filter === 'all') return true;
  if (filter === 'new') return record.status === 'submitted';
  if (filter === 'assigned') return record.status === 'assigned';
  if (filter === 'en_route') return record.status === 'en_route';
  if (filter === 'resolved') return record.status === 'resolved';
  if (filter === 'live') return !record.is_demo;
  if (filter === 'demo') return Boolean(record.is_demo);
  return true;
}

function labelFor(filter: string) {
  if (filter === 'new') return 'New';
  if (filter === 'assigned') return 'Assigned';
  if (filter === 'en_route') return 'En Route';
  if (filter === 'resolved') return 'Resolved';
  if (filter === 'live') return 'Live only';
  if (filter === 'demo') return 'Demo';
  return 'All';
}

function countFor(filter: string) {
  return records.filter((record) => matches(record, filter)).length;
}

function selectFirstVisible(queuePane: HTMLElement) {
  if (selecting) return;
  const selected = queuePane.querySelector<HTMLButtonElement>('.ops-queue-list > button.active');
  if (selected && selected.style.display !== 'none' && getComputedStyle(selected).display !== 'none') return;

  const first = Array.from(queuePane.querySelectorAll<HTMLButtonElement>('.ops-queue-list > button'))
    .find((card) => card.style.display !== 'none' && getComputedStyle(card).display !== 'none');

  if (!first) return;
  selecting = true;
  requestAnimationFrame(() => {
    try { first.click(); }
    finally { selecting = false; }
  });
}

function renderEmptyState(queuePane: HTMLElement, visibleCount: number) {
  const list = queuePane.querySelector<HTMLElement>('.ops-queue-list');
  if (!list) return;
  let empty = list.querySelector<HTMLElement>('[data-final-filter-empty]');
  if (visibleCount > 0) {
    empty?.remove();
    return;
  }
  if (!empty) {
    empty = document.createElement('div');
    empty.dataset.finalFilterEmpty = 'true';
    empty.className = 'incident-filter-empty-final';
    list.appendChild(empty);
  }
  empty.textContent = `No ${labelFor(activeFilter).toLowerCase()} incidents right now.`;
}

function applyFilter() {
  if (!onResponder()) return;
  const queuePane = document.querySelector<HTMLElement>('.ops-queue-pane');
  const registryOpen = Boolean(document.querySelector('[data-incident-registry-v2]'));
  if (!queuePane || registryOpen || queuePane.style.display === 'none') return;

  const byId = new Map(records.map((record) => [record.id, record]));
  const cards = Array.from(queuePane.querySelectorAll<HTMLButtonElement>('.ops-queue-list > button'));
  let visibleCount = 0;

  cards.forEach((card) => {
    const record = byId.get(cardId(card));
    const visible = record ? matches(record, activeFilter) : activeFilter === 'all';
    card.style.setProperty('display', visible ? '' : 'none', visible ? '' : 'important');
    card.style.pointerEvents = 'auto';
    card.style.position = card.style.position || 'relative';
    card.style.zIndex = '2';
    if (visible) visibleCount += 1;
  });

  const filters = Array.from(queuePane.querySelectorAll<HTMLButtonElement>('[data-incident-filter]'));
  filters.forEach((button) => {
    const key = button.dataset.incidentFilter || 'all';
    button.style.removeProperty('display');
    button.style.pointerEvents = 'auto';
    button.style.position = 'relative';
    button.style.zIndex = '20';
    button.disabled = false;
    button.classList.toggle('active', key === activeFilter);
    button.setAttribute('aria-pressed', String(key === activeFilter));
    const count = button.querySelector('b');
    if (count) count.textContent = String(countFor(key));
  });

  const heading = queuePane.querySelector<HTMLElement>('header h2');
  if (heading) heading.textContent = 'Approve Requests';
  const subtitle = queuePane.querySelector<HTMLElement>('header span');
  if (subtitle) subtitle.textContent = `${labelFor(activeFilter)} incidents · auto-refresh 5s`;

  renderEmptyState(queuePane, visibleCount);
  selectFirstVisible(queuePane);
}

function onFilterClick(event: Event) {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>('.ops-queue-pane [data-incident-filter]');
  if (!button) return;

  // Own queue filtering here so enhancer re-renders cannot race each other.
  event.preventDefault();
  event.stopImmediatePropagation();
  activeFilter = button.dataset.incidentFilter || 'all';
  applyFilter();
}

function start() {
  if (!onResponder()) return;

  document.addEventListener('click', onFilterClick, true);
  void refreshRecords().then(applyFilter);

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      applyFilter();
    }, 40);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.setInterval(() => {
    void refreshRecords().then(applyFilter);
  }, 5000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
