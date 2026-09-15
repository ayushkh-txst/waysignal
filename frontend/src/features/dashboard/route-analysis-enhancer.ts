import './route-analysis-enhancer.css';

type ScreenedRoute = {
  id?: string;
  status: 'rejected' | 'viable' | 'recommended';
  distance_m?: number;
  duration_s?: number;
  prototype_safety_score?: number;
  rejection_reasons?: string[];
};

type RouteAnalysisPayload = {
  alternatives_considered: number;
  rejected_count?: number;
  viable_count?: number;
  recommended_count?: number;
  screening_status?: 'pending' | 'complete';
  screened_routes?: ScreenedRoute[];
};

const SUMMARY_CLASS = 'route-analysis-summary';
let latestAnalysis: RouteAnalysisPayload | null = null;

function getAnalyzedCountFromDom(): number | null {
  const statusRows = Array.from(document.querySelectorAll<HTMLElement>('.map-status-row span'));
  for (const row of statusRows) {
    const match = row.textContent?.match(/(\d+)\s+route options considered/i);
    if (match) return Number(match[1]);
  }
  return null;
}

const formatMinutes = (seconds?: number) => seconds == null ? '' : `${Math.max(1, Math.round(seconds / 60))} min`;
const formatDistance = (meters?: number) => meters == null ? '' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.max(1, Math.round(meters))} m`;

function rejectedRoutesHtml(routes: ScreenedRoute[]) {
  const rejected = routes.filter((route) => route.status === 'rejected').slice(0, 4);
  if (!rejected.length) return '';

  return `
    <details class="route-analysis-details">
      <summary>View rejected routes</summary>
      <div class="route-analysis-rejected-list">
        ${rejected.map((route, index) => {
          const meta = [formatMinutes(route.duration_s), formatDistance(route.distance_m)].filter(Boolean).join(' · ');
          const reasons = route.rejection_reasons?.length ? route.rejection_reasons : ['Rejected by route safety screening'];
          return `
            <article>
              <div class="rejected-route-title"><span>✕</span><strong>Rejected route ${index + 1}</strong>${meta ? `<small>${meta}</small>` : ''}</div>
              ${reasons.map((reason) => `<p>${reason}</p>`).join('')}
            </article>
          `;
        }).join('')}
      </div>
    </details>
  `;
}

function ensureRouteAnalysisSummary() {
  const routePanel = document.querySelector<HTMLElement>('.route-panel');
  if (!routePanel) return;
  if (routePanel.hasAttribute('data-react-route-analysis')) return;

  const analyzedFromDom = getAnalyzedCountFromDom();
  const analyzed = latestAnalysis?.alternatives_considered ?? analyzedFromDom;
  const routeExists = Boolean(document.querySelector('.interactive-safety-map')) && analyzed !== null;

  let summary = routePanel.querySelector<HTMLElement>(`.${SUMMARY_CLASS}`);
  if (!summary) {
    summary = document.createElement('section');
    summary.className = SUMMARY_CLASS;
    summary.setAttribute('aria-label', 'Route analysis summary');

    const originCard = routePanel.querySelector('.route-origin-card');
    const metrics = routePanel.querySelector('.route-metrics');
    if (originCard?.parentElement === routePanel) {
      originCard.insertAdjacentElement('afterend', summary);
    } else if (metrics?.parentElement === routePanel) {
      routePanel.insertBefore(summary, metrics);
    } else {
      routePanel.appendChild(summary);
    }
  }

  if (!routeExists) {
    summary.innerHTML = `
      <div class="route-analysis-heading">
        <span>ROUTE ANALYSIS</span>
        <strong>Waiting for route calculation</strong>
      </div>
      <div class="route-analysis-grid route-analysis-grid--pending">
        <div><b>—</b><span>Analyzed</span></div>
        <div><b>—</b><span>Rejected</span></div>
        <div><b>—</b><span>Viable</span></div>
        <div><b>—</b><span>Recommended</span></div>
      </div>
      <p class="route-analysis-note">Use your location to calculate and compare nearby evacuation routes.</p>
    `;
    return;
  }

  const screeningComplete = latestAnalysis?.screening_status === 'complete'
    && typeof latestAnalysis.rejected_count === 'number'
    && typeof latestAnalysis.viable_count === 'number';

  const rejected = screeningComplete ? latestAnalysis?.rejected_count ?? 0 : null;
  const viable = screeningComplete ? latestAnalysis?.viable_count ?? 0 : null;
  const recommended = latestAnalysis?.recommended_count ?? 1;
  const screenedRoutes = latestAnalysis?.screened_routes ?? [];

  summary.innerHTML = `
    <div class="route-analysis-heading">
      <span>ROUTE ANALYSIS</span>
      <strong>${analyzed} alternatives compared</strong>
    </div>
    <div class="route-analysis-grid">
      <div class="analysis-analyzed"><b>${analyzed}</b><span>Analyzed</span></div>
      <div class="analysis-rejected ${screeningComplete ? '' : 'analysis-pending'}"><b>${rejected ?? '—'}</b><span>Rejected</span></div>
      <div class="analysis-viable ${screeningComplete ? '' : 'analysis-pending'}"><b>${viable ?? '—'}</b><span>Viable</span></div>
      <div class="analysis-recommended"><b>${recommended}</b><span>Recommended</span></div>
    </div>
    <div class="route-analysis-screening ${screeningComplete ? 'screening-complete' : ''}">
      <span class="route-analysis-pulse" aria-hidden="true"></span>
      <div>
        <strong>${screeningComplete ? 'Safety screening complete' : 'Hazard screening pending'}</strong>
        <p>${screeningComplete
          ? `${rejected} route${rejected === 1 ? '' : 's'} rejected · ${viable} viable route${viable === 1 ? '' : 's'} · safest viable route recommended.`
          : 'Rejected and viable counts will appear here once hazard and road-closure screening is returned by the routing service.'}</p>
      </div>
    </div>
    ${screeningComplete ? rejectedRoutesHtml(screenedRoutes) : ''}
  `;
}

let scheduled = false;
function scheduleUpdate() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    ensureRouteAnalysisSummary();
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('jalrakshak:route-analysis', ((event: Event) => {
    latestAnalysis = (event as CustomEvent<RouteAnalysisPayload>).detail;
    scheduleUpdate();
  }) as EventListener);

  const observer = new MutationObserver(scheduleUpdate);
  const start = () => {
    scheduleUpdate();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
