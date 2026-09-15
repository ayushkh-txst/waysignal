import { hazardsApi, type HazardKind, type HazardReport as UserHazardReport } from './api/hazards.api';
import { authSession } from '../auth/auth-session';

type LeafletLike = {
  map: (...args: any[]) => any;
  layerGroup: (...args: any[]) => any;
  marker: (...args: any[]) => any;
  circle: (...args: any[]) => any;
  divIcon: (...args: any[]) => any;
  control?: (...args: any[]) => any;
};

const PATCH_FLAG = '__jalrakshakUserHazardPatched';
const maps = new Set<any>();
const reportLayers = new WeakMap<any, any>();
let installTimer: number | null = null;
let unsubscribe: (() => void) | null = null;
const feedLabels = new WeakMap<any, HTMLElement>();
const hiddenMaps = new WeakSet<any>();

export function setSharedHazardsVisible(map: any, visible: boolean) {
  if (visible) hiddenMaps.delete(map); else hiddenMaps.add(map);
  const layer = reportLayers.get(map);
  if (layer) { if (visible) layer.addTo(map); else map.removeLayer(layer); }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function readReports(): UserHazardReport[] {
  return hazardsApi.snapshot().reports;
}

function ageLabel(value: string) {
  const age = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(age / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'} ago`;
}

function markerGlyph(kind: HazardKind) {
  if (kind === 'flooded_road') return '≈';
  if (kind === 'debris') return '◆';
  if (kind === 'road_blocked') return '×';
  return '!';
}

function reportRadius(report: UserHazardReport) {
  const base = report.kind === 'flooded_road' ? 110 : report.kind === 'road_blocked' ? 85 : report.kind === 'debris' ? 60 : 55;
  const accuracy = Number.isFinite(report.accuracy_m) ? Math.max(0, Number(report.accuracy_m)) : 0;
  return Math.min(180, base + Math.min(accuracy, 50));
}

function renderReportsOnMap(map: any, L: LeafletLike) {
  if (!map || !L?.layerGroup) return;
  const state = hazardsApi.snapshot();
  let label = feedLabels.get(map);
  if (!label && L.control) {
    const control = L.control({ position: 'bottomleft' });
    label = document.createElement('div');
    label.style.cssText = 'background:#fffdf8;padding:6px 10px;border:1px solid #e4d9c6;border-radius:6px;font-size:11px;max-width:260px;';
    control.onAdd = () => label;
    control.addTo(map);
    feedLabels.set(map, label);
  }
  if (label) label.textContent = state.error ? 'Shared hazards unavailable · markers may be out of date'
    : state.checkedAt ? `Shared hazards · ${state.reports.length} active · checked ${new Date(state.checkedAt).toLocaleTimeString()}`
    : 'Loading shared hazards…';
  // Keep an open popup usable across unchanged polling responses.
  const revision = JSON.stringify(state.reports.map(report => [report.id, report.updated_at]));
  if (map.__jalrakshakHazardRevision === revision) return;
  map.__jalrakshakHazardRevision = revision;
  const old = reportLayers.get(map);
  if (old) {
    try { map.removeLayer(old); } catch {}
  }

  const group = L.layerGroup();
  if (!hiddenMaps.has(map)) group.addTo(map);
  reportLayers.set(map, group);

  for (const report of readReports()) {
    const radius = reportRadius(report);
    const accuracy = report.accuracy_m == null ? 'GPS accuracy unavailable' : `GPS accuracy ±${Math.round(report.accuracy_m)} m`;
    const icon = L.divIcon({
      className: 'jalrakshak-user-hazard-marker',
      html: `<span>${markerGlyph(report.kind)}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    const marker = L.marker([report.latitude, report.longitude], { icon }).addTo(group);
    L.circle([report.latitude, report.longitude], {
      radius,
      color: '#b63a32',
      weight: 2,
      opacity: .8,
      fillColor: '#c94a40',
      fillOpacity: .12,
      dashArray: '6 6',
      interactive: false,
    }).addTo(group);
    const popup = document.createElement('div');
    popup.innerHTML = `
      <div class="user-hazard-popup">
        <strong>USER REPORTED</strong>
        <b>${escapeHtml(report.label)}</b>
        <span>${escapeHtml(report.id)} · ${ageLabel(report.created_at)}</span>
        <span>${escapeHtml(accuracy)}</span>
        <small>Unverified report. JalRakshak uses it conservatively during prototype route screening.</small>
      </div>
    `;
    if (authSession.get()?.user.role === 'worker') {
      const resolve = document.createElement('button');
      resolve.type = 'button';
      resolve.textContent = 'Mark resolved';
      resolve.addEventListener('click', async () => {
        resolve.disabled = true;
        try { await hazardsApi.setStatus(report.id, 'resolved'); }
        catch (error) { resolve.disabled = false; resolve.textContent = error instanceof Error ? error.message : 'Resolution failed. Retry.'; }
      });
      popup.append(resolve);
      if (report.has_photo) {
        const photo = document.createElement('button');
        photo.type = 'button'; photo.textContent = 'View report photo';
        photo.addEventListener('click', async () => {
          photo.disabled = true;
          try {
            const result = await hazardsApi.photo(report.id);
            const image = document.createElement('img');
            image.src = result.data_url; image.alt = 'Unverified hazard report'; image.style.maxWidth = '220px';
            popup.append(image); photo.remove();
          } catch (error) { photo.disabled = false; photo.textContent = error instanceof Error ? error.message : 'Photo unavailable.'; }
        });
        popup.append(photo);
      }
    }
    marker.bindPopup(popup);
  }
}

function refreshAllMaps() {
  const L = (window as any).L as LeafletLike | undefined;
  if (!L) return;
  maps.forEach((map) => renderReportsOnMap(map, L));
}

export function attachSharedHazards(map: any, L: LeafletLike) {
  if (maps.has(map)) return;
  maps.add(map);
  if (!unsubscribe) unsubscribe = hazardsApi.subscribe(refreshAllMaps);
  const originalRemove = typeof map.remove === 'function' ? map.remove.bind(map) : null;
  if (originalRemove) {
    map.remove = (...args: any[]) => {
      maps.delete(map);
      reportLayers.delete(map);
      feedLabels.delete(map);
      if (!maps.size) { unsubscribe?.(); unsubscribe = null; }
      return originalRemove(...args);
    };
  }
  window.setTimeout(() => { if (maps.has(map)) renderReportsOnMap(map, L); }, 0);
}

function patchLeaflet() {
  const browser = window as any;
  const L = browser.L as (LeafletLike & Record<string, any>) | undefined;
  if (!L?.map || L[PATCH_FLAG]) return Boolean(L?.map);

  const originalMap = L.map.bind(L);
  L.map = (...args: any[]) => {
    const map = originalMap(...args);
    attachSharedHazards(map, L);
    return map;
  };
  L[PATCH_FLAG] = true;
  return true;
}

function watchLeafletScript() {
  document.querySelectorAll<HTMLScriptElement>('script[data-jalrakshak-leaflet]').forEach((script) => {
    if (script.dataset.userHazardHooked) return;
    script.dataset.userHazardHooked = 'true';
    script.addEventListener('load', () => patchLeaflet(), { once: true });
  });
}

function install() {
  watchLeafletScript();
  if (patchLeaflet()) {
    if (installTimer != null) window.clearInterval(installTimer);
    installTimer = null;
  }
}

const observer = new MutationObserver(install);
observer.observe(document.documentElement, { childList: true, subtree: true });
install();
installTimer = window.setInterval(install, 100);
window.setTimeout(() => {
  if (installTimer != null) window.clearInterval(installTimer);
  installTimer = null;
}, 12_000);
