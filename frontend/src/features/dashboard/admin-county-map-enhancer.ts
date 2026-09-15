const COUNTY_QUERIES: Record<string, string> = {
  'Harris County': 'Harris County, Texas',
  'Fort Bend County': 'Fort Bend County, Texas',
  'Brazoria County': 'Brazoria County, Texas',
  'Galveston County': 'Galveston County, Texas',
};

type LayerKey = 'risk' | 'incidents' | 'safe' | 'responders' | 'routes';

function countyName(root: HTMLElement) {
  const select = root.querySelector<HTMLSelectElement>('[data-district-select]');
  if (select?.selectedOptions[0]?.textContent?.trim()) return select.selectedOptions[0].textContent.trim();
  const heading = root.querySelector<HTMLElement>('.card-row strong')?.textContent ?? '';
  const match = heading.match(/^(.+?)\s*·/);
  return match?.[1]?.trim() || 'Harris County';
}

function googleMapUrl(name: string) {
  const query = COUNTY_QUERIES[name] || `${name}, Texas`;
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=11&output=embed`;
}

function markerHtml(stage: HTMLElement, selector: string, cls: string) {
  return Array.from(stage.querySelectorAll<HTMLElement>(selector)).map((node, index) => {
    const label = node.textContent?.trim() || '•';
    const title = node.getAttribute('title') || '';
    return `<span class="county-map-marker ${cls} ${cls}-${index}" title="${title.replace(/\"/g, '&quot;')}">${label}</span>`;
  }).join('');
}

function installCountyMap(root: HTMLElement) {
  if (!root.classList.contains('district-view')) return;
  const stage = root.querySelector<HTMLElement>('.district-map-stage');
  if (!stage || stage.dataset.googleCountyMap === 'true') return;

  const incidents = markerHtml(stage, '.incident-dot', 'layer-incidents');
  const responders = markerHtml(stage, '.responder-dot', 'layer-responders');
  const safe = markerHtml(stage, '.safe-zone-dot', 'layer-safe');
  const name = countyName(root);

  stage.dataset.googleCountyMap = 'true';
  stage.innerHTML = `
    <iframe class="county-google-map" title="${name} operations map" src="${googleMapUrl(name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
    <div class="county-map-overlay" aria-hidden="true">
      <div class="county-risk-zone county-critical layer-risk"></div>
      <div class="county-risk-zone county-high layer-risk"></div>
      <svg class="county-route-lines layer-routes" viewBox="0 0 1000 600" preserveAspectRatio="none">
        <path d="M275 270 C390 360 520 430 670 500" />
        <path d="M510 225 C555 325 610 405 670 500" />
        <path d="M690 300 C685 365 680 430 670 500" />
      </svg>
      ${incidents}${responders}${safe}
      <div class="county-map-legend">
        <span><i class="legend-critical"></i>Critical risk</span>
        <span><i class="legend-high"></i>High risk</span>
        <span><i class="legend-incident"></i>SOS / Incident</span>
        <span><i class="legend-safe"></i>Safe zone</span>
        <span><i class="legend-responder"></i>Responder</span>
      </div>
    </div>
    <div class="county-map-source">Google Maps base layer · JalRakshak operational overlays</div>
  `;

  const tabs = root.querySelector<HTMLElement>('.map-layer-tabs');
  if (!tabs) return;
  const defs: Array<[LayerKey, string]> = [
    ['risk', 'Risk Areas'],
    ['incidents', 'Incidents'],
    ['safe', 'Safe Zones'],
    ['responders', 'Responders'],
    ['routes', 'Routes'],
  ];

  tabs.querySelectorAll('button').forEach((button, index) => {
    const [key] = defs[index] ?? ['risk', 'Risk Areas'];
    button.setAttribute('data-map-layer', key);
    button.classList.add('active');
  });

  tabs.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-map-layer]');
    if (!button) return;
    const key = button.dataset.mapLayer as LayerKey;
    button.classList.toggle('active');
    const visible = button.classList.contains('active');
    stage.querySelectorAll<HTMLElement>(`.layer-${key}`).forEach((el) => {
      el.style.display = visible ? '' : 'none';
    });
  });
}

function fixDistrictHeader(root: HTMLElement) {
  if (!root.classList.contains('district-view')) return;
  const buttons = root.querySelectorAll<HTMLButtonElement>('.view-toggle button[data-mode]');
  buttons.forEach((button) => {
    if (button.dataset.mode === 'global') {
      button.textContent = '← BACK';
      button.classList.remove('active');
      button.setAttribute('aria-label', 'Back to regional dashboard');
    }
    if (button.dataset.mode === 'district') {
      button.textContent = 'COUNTY VIEW';
      button.classList.add('active');
    }
  });
}

function enhance() {
  const root = document.querySelector<HTMLElement>('[data-admin-dashboard]');
  if (!root) return;
  fixDistrictHeader(root);
  installCountyMap(root);
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhance();
  });
}

const observer = new MutationObserver(schedule);
const start = () => {
  schedule();
  observer.observe(document.body, { childList: true, subtree: true });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
