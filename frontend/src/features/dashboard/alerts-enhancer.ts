import { citizenSafetyApi, type EmergencyRecord, type SafetyContext } from './api/citizen-safety.api';

type RouteAnalysisDetail = {
  alternatives_considered?: number;
  rejected_count?: number;
  viable_count?: number;
  recommended_count?: number;
  screening_status?: 'pending' | 'complete';
  prototype_safety_score?: number;
  destination_name?: string;
  duration_s?: number;
  distance_m?: number;
  warning?: string;
};

type AlertCategory = 'critical' | 'route' | 'responder' | 'system';
type LocationPermissionState = 'granted' | 'prompt' | 'denied' | 'unknown';

let latestRoute: RouteAnalysisDetail | null = null;
let latestSafety: SafetyContext | null = null;
let latestEmergencies: EmergencyRecord[] = [];
let latestDataError = '';
let lastRenderedLocation = '';
let activeCategory: AlertCategory = 'critical';
let refreshing = false;
let lastRefreshAt = 0;
let locationPermission: LocationPermissionState = 'unknown';

function findNavButton(label: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>('.figma-nav button')]
    .find((button) => button.textContent?.trim().includes(label)) ?? null;
}

function currentCitizenName(): string {
  return document.querySelector<HTMLElement>('.sidebar-user strong')?.textContent?.trim() || 'Ramesh K.';
}

function currentLocationLabel(): string {
  const topbar = document.querySelector<HTMLElement>('.location-line');
  const raw = topbar?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (!raw || raw.includes('Bagmati Valley, Sindhupalchowk')) return 'Bagmati Valley';
  return raw.replace(/^⌖\s*/, '').replace(/\s*·\s*LIVE\s*$/, '').trim();
}

function formatAgo(value?: string | null): string {
  if (!value) return 'Live';
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return 'Live';
  const diff = Math.max(0, Date.now() - stamp);
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  return `${Math.floor(diff / 3_600_000)} hr ago`;
}

function formatDistance(meters?: number): string {
  if (typeof meters !== 'number') return '—';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds?: number): string {
  if (typeof seconds !== 'number') return '—';
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function riskPresentation() {
  const level = latestSafety?.prototype_risk_level;
  const score = latestSafety?.prototype_risk_score;
  if (!level || typeof score !== 'number') {
    return { level: 'DEMO', score: '87/100', isUrgent: true, isDemo: true };
  }
  return {
    level: level.toUpperCase(),
    score: `${score}/100`,
    isUrgent: level === 'high' || level === 'critical',
    isDemo: false,
  };
}

function userEmergencies(): EmergencyRecord[] {
  const name = currentCitizenName().toLowerCase();
  return latestEmergencies
    .filter((record) => !record.is_demo && record.citizen_name?.toLowerCase() === name)
    .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime());
}

function renderTabs() {
  const risk = riskPresentation();
  const criticalCount = risk.isDemo ? 2 : risk.isUrgent ? 2 : 0;
  const routeCount = latestRoute ? 1 : 0;
  const emergency = userEmergencies()[0];
  const responderCount = emergency && emergency.status !== 'cancelled' ? 1 : 0;
  return `
    <div class="figma-alert-tabs" role="tablist" aria-label="Alert categories">
      <button type="button" data-alert-tab="critical" class="${activeCategory === 'critical' ? 'active' : ''}">Critical Alerts ${criticalCount ? `<b>${criticalCount}</b>` : ''}</button>
      <button type="button" data-alert-tab="route" class="${activeCategory === 'route' ? 'active' : ''}">Route Updates ${routeCount ? `<b>${routeCount}</b>` : ''}</button>
      <button type="button" data-alert-tab="responder" class="${activeCategory === 'responder' ? 'active' : ''}">Responder Updates ${responderCount ? `<b>${responderCount}</b>` : ''}</button>
      <button type="button" data-alert-tab="system" class="${activeCategory === 'system' ? 'active' : ''}">System Notices <b>3</b></button>
    </div>
  `;
}

function criticalAlerts(location: string) {
  const risk = riskPresentation();

  if (latestSafety) {
    const rainfall = latestSafety.precipitation_next_6h_mm.toFixed(1);
    const rainProbability = latestSafety.precipitation_probability_max_6h;
    const discharge = latestSafety.river_discharge_m3s;
    const trend = latestSafety.river_trend_percent;

    if (!risk.isUrgent) {
      return `
        <div class="figma-alert-feed">
          <article class="figma-feed-card route-update">
            <div class="feed-card-heading"><span><i></i> NO CRITICAL FLOOD ALERTS</span><time>Live</time></div>
            <p>${escapeHtml(location)} is currently modeled at ${risk.level} risk (${risk.score}). JalRakshak will keep monitoring live environmental inputs.</p>
          </article>
          <article class="figma-feed-card system-neutral">
            <div class="feed-card-heading"><span><i></i> LIVE ENVIRONMENTAL SNAPSHOT</span><time>Just now</time></div>
            <p>Rain next 6h: ${rainfall} mm${rainProbability != null ? ` · probability ${rainProbability}%` : ''}${discharge != null ? ` · river discharge ${discharge.toFixed(1)} m³/s` : ''}${trend != null ? ` · river trend ${trend > 0 ? '+' : ''}${trend.toFixed(1)}%` : ''}.</p>
          </article>
        </div>
      `;
    }

    return `
      <div class="figma-alert-feed">
        <article class="figma-feed-card critical">
          <div class="feed-card-heading"><span><i></i> MODELED FLOOD-RISK ALERT</span><time>Just now</time></div>
          <p>${escapeHtml(location)} is currently modeled at ${risk.level} risk (${risk.score}). Review your evacuation route and be ready to move.</p>
        </article>
        <article class="figma-feed-card rising">
          <div class="feed-card-heading"><span><i></i> LIVE ENVIRONMENTAL UPDATE</span><time>Live</time></div>
          <p>Rain next 6h: ${rainfall} mm${rainProbability != null ? ` · probability ${rainProbability}%` : ''}${discharge != null ? ` · river discharge ${discharge.toFixed(1)} m³/s` : ''}${trend != null ? ` · river trend ${trend > 0 ? '+' : ''}${trend.toFixed(1)}%` : ''}.</p>
        </article>
      </div>
    `;
  }

  return `
    <div class="figma-alert-feed">
      <article class="figma-feed-card critical">
        <div class="feed-card-heading"><span><i></i> DEMO SCENARIO · CRITICAL FLOOD WARNING</span><time>Demo</time></div>
        <p>Bagmati Valley demo risk has reached CRITICAL (87/100). This controlled scenario is used to demonstrate JalRakshak when no real disaster is occurring.</p>
      </article>
      <article class="figma-feed-card rising">
        <div class="feed-card-heading"><span><i></i> DEMO SCENARIO · RISING WATER LEVEL</span><time>Demo</time></div>
        <p>Modeled water levels are rising in the demo area. Open Live Map and use your current location to switch this screen to live data.</p>
      </article>
      ${latestDataError ? `<div class="alert-caveat">${escapeHtml(latestDataError)}</div>` : ''}
    </div>
  `;
}

function routeUpdates() {
  const analyzed = latestRoute?.alternatives_considered ?? 0;
  const rejected = latestRoute?.rejected_count;
  const viable = latestRoute?.viable_count;
  const screeningComplete = latestRoute?.screening_status === 'complete';
  const destination = latestRoute?.destination_name;

  const message = analyzed
    ? screeningComplete && typeof rejected === 'number' && typeof viable === 'number'
      ? `JalRakshak analyzed ${analyzed} route option${analyzed === 1 ? '' : 's'}: ${rejected} rejected and ${viable} viable.${destination ? ` ${destination} is the current recommendation.` : ''}`
      : `JalRakshak analyzed ${analyzed} route option${analyzed === 1 ? '' : 's'}. Hazard screening is still limited for this location.`
    : 'Use your location on the Live Map to calculate and compare real-road evacuation options.';

  return `
    <div class="figma-alert-feed">
      <article class="figma-feed-card route-update">
        <div class="feed-card-heading"><span><i></i> ROUTE UPDATE — SAFEST AVAILABLE PATH</span><time>${latestRoute ? 'Live' : 'Waiting'}</time></div>
        <p>${escapeHtml(message)}</p>
        ${latestRoute ? `<div class="feed-route-meta"><span><b>${analyzed}</b> analyzed</span><span><b>${typeof rejected === 'number' ? rejected : '—'}</b> rejected</span><span><b>${typeof viable === 'number' ? viable : '—'}</b> viable</span><span><b>${formatDuration(latestRoute.duration_s)}</b> ETA</span><span><b>${formatDistance(latestRoute.distance_m)}</b> distance</span></div>` : ''}
        <button type="button" class="feed-inline-action" data-alert-action="map">View route</button>
      </article>
      ${latestRoute?.warning ? `<div class="alert-caveat">${escapeHtml(latestRoute.warning)}</div>` : ''}
    </div>
  `;
}

function responderUpdates() {
  const emergency = userEmergencies()[0];
  if (!emergency) {
    return `
      <div class="figma-empty-category">
        <div class="empty-check">✓</div>
        <p>No responder updates yet</p>
        <small>Submit an SOS from Emergency Help and its live status will appear here.</small>
      </div>
    `;
  }

  const statusLabel = emergency.status.replace('_', ' ').toUpperCase();
  const headline = emergency.status === 'submitted' ? 'SOS RECEIVED — WAITING FOR RESPONDER'
    : emergency.status === 'assigned' ? 'RESPONDER ASSIGNED'
    : emergency.status === 'en_route' ? 'HELP IS ON THE WAY'
    : emergency.status === 'resolved' ? 'RESPONSE COMPLETE'
    : 'SOS REQUEST CANCELLED';
  const message = emergency.status === 'submitted'
    ? `Request ${emergency.id} is live in the responder queue.`
    : emergency.status === 'assigned'
      ? `${emergency.responder_name ?? 'A responder'} has accepted request ${emergency.id}.`
      : emergency.status === 'en_route'
        ? `${emergency.responder_name ?? 'Your responder'} is traveling to your latest GPS location.`
        : emergency.status === 'resolved'
          ? `Request ${emergency.id} was marked resolved by ${emergency.responder_name ?? 'the responder'}.`
          : `Request ${emergency.id} is no longer active.`;

  return `
    <div class="figma-alert-feed">
      <article class="figma-feed-card ${emergency.status === 'resolved' ? 'route-update' : emergency.status === 'cancelled' ? 'system-neutral' : 'rising'}">
        <div class="feed-card-heading"><span><i></i> ${headline}</span><time>${formatAgo(emergency.updated_at ?? emergency.created_at)}</time></div>
        <p>${escapeHtml(message)}</p>
        <div class="feed-route-meta"><span><b>${statusLabel}</b> status</span><span><b>${emergency.people_count}</b> people</span><span><b>${emergency.emergency_type.toUpperCase()}</b> type</span></div>
        <button type="button" class="feed-inline-action" data-alert-action="help">Open emergency tracking</button>
      </article>
    </div>
  `;
}

function systemNotices() {
  const online = navigator.onLine;
  const routeReady = Boolean(latestRoute);
  const safetyReady = Boolean(latestSafety);
  const permissionTitle = locationPermission === 'granted' ? 'LOCATION PERMISSION ACTIVE'
    : locationPermission === 'denied' ? 'LOCATION PERMISSION BLOCKED'
    : 'LOCATION PERMISSION STATUS';
  const permissionCopy = locationPermission === 'granted'
    ? 'Device location access is enabled for route, risk, and responder accuracy.'
    : locationPermission === 'denied'
      ? 'Location access is blocked. JalRakshak will use the last available location until permission is restored.'
      : 'Use My Location on the Live Map to enable current-position routing and live safety context.';

  return `
    <div class="figma-alert-feed system-feed">
      <article class="figma-feed-card system-neutral">
        <div class="feed-card-heading"><span><i></i> ${permissionTitle}</span><time>Live</time></div>
        <p>${permissionCopy}</p>
      </article>
      <article class="figma-feed-card ${online ? 'route-update' : 'system-warning'}">
        <div class="feed-card-heading"><span><i></i> ${online ? 'NETWORK CONNECTED' : 'OFFLINE MODE ACTIVE'}</span><time>Now</time></div>
        <p>${online ? `Browser network is online.${routeReady ? ' A current route is available.' : ''}` : 'Live services are unavailable. Keep the most recent route visible and reconnect when possible.'}</p>
      </article>
      <article class="figma-feed-card system-neutral">
        <div class="feed-card-heading"><span><i></i> LIVE DATA SERVICES</span><time>Now</time></div>
        <p>Environmental context: ${safetyReady ? `connected (${escapeHtml(latestSafety?.source ?? 'live source')})` : 'waiting for GPS'} · routing: ${routeReady ? 'connected' : 'waiting for route calculation'} · responder workflow: connected.</p>
      </article>
    </div>
  `;
}

function categoryContent(location: string) {
  if (activeCategory === 'route') return routeUpdates();
  if (activeCategory === 'responder') return responderUpdates();
  if (activeCategory === 'system') return systemNotices();
  return criticalAlerts(location);
}

function renderAlertsScreen(section: HTMLElement) {
  const location = currentLocationLabel();
  section.className = 'citizen-alerts-screen figma-alerts-screen';
  section.innerHTML = `
    <div class="figma-alerts-shell">
      ${renderTabs()}
      <div class="figma-alert-category-body" role="tabpanel">
        ${categoryContent(location)}
      </div>
    </div>
  `;

  section.querySelectorAll<HTMLButtonElement>('[data-alert-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeCategory = button.dataset.alertTab as AlertCategory;
      renderAlertsScreen(section);
    });
  });

  section.querySelectorAll<HTMLButtonElement>('[data-alert-action="map"]').forEach((button) => {
    button.addEventListener('click', () => findNavButton('Live Map')?.click());
  });
  section.querySelectorAll<HTMLButtonElement>('[data-alert-action="help"]').forEach((button) => {
    button.addEventListener('click', () => findNavButton('Emergency Help')?.click());
  });

  lastRenderedLocation = location;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char] ?? char));
}

async function readLocationPermission() {
  try {
    if (!navigator.permissions?.query) return;
    const status = await navigator.permissions.query({ name: 'geolocation' });
    locationPermission = status.state as LocationPermissionState;
    status.onchange = () => {
      locationPermission = status.state as LocationPermissionState;
      const screen = document.querySelector<HTMLElement>('.citizen-alerts-screen');
      if (screen) renderAlertsScreen(screen);
    };
  } catch {
    locationPermission = 'unknown';
  }
}

function acquireLiveSafety(): Promise<void> {
  return new Promise((resolve) => {
    if (!navigator.geolocation || locationPermission === 'denied') return resolve();
    if (locationPermission !== 'granted') return resolve();
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          latestSafety = await citizenSafetyApi.getContext(position.coords.latitude, position.coords.longitude);
          latestDataError = '';
        } catch (error) {
          latestDataError = error instanceof Error ? error.message : 'Live environmental context unavailable';
        }
        resolve();
      },
      () => resolve(),
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 3500 },
    );
  });
}

async function refreshLiveData(force = false) {
  if (refreshing) return;
  if (!force && Date.now() - lastRefreshAt < 5000) return;
  refreshing = true;
  lastRefreshAt = Date.now();
  try {
    await readLocationPermission();
    const emergencyPromise = citizenSafetyApi.listEmergencies()
      .then((records) => { latestEmergencies = records; })
      .catch(() => undefined);
    await Promise.all([emergencyPromise, acquireLiveSafety()]);
  } finally {
    refreshing = false;
    const screen = document.querySelector<HTMLElement>('.citizen-alerts-screen');
    if (screen) renderAlertsScreen(screen);
  }
}

function maybeEnhanceAlerts() {
  const placeholder = document.querySelector<HTMLElement>('.figma-placeholder-panel');
  if (placeholder) {
    const heading = placeholder.querySelector('h2')?.textContent?.trim();
    if (heading === 'Alerts') {
      renderAlertsScreen(placeholder);
      void refreshLiveData();
    }
    return;
  }

  const alertsScreen = document.querySelector<HTMLElement>('.citizen-alerts-screen');
  if (alertsScreen && currentLocationLabel() !== lastRenderedLocation) {
    renderAlertsScreen(alertsScreen);
    void refreshLiveData();
  }
}

window.addEventListener('jalrakshak:route-analysis', (event) => {
  latestRoute = (event as CustomEvent<RouteAnalysisDetail>).detail;
  const screen = document.querySelector<HTMLElement>('.citizen-alerts-screen');
  if (screen) renderAlertsScreen(screen);
});
window.addEventListener('online', () => {
  const screen = document.querySelector<HTMLElement>('.citizen-alerts-screen');
  if (screen) renderAlertsScreen(screen);
});
window.addEventListener('offline', () => {
  const screen = document.querySelector<HTMLElement>('.citizen-alerts-screen');
  if (screen) renderAlertsScreen(screen);
});

const observer = new MutationObserver(() => maybeEnhanceAlerts());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', maybeEnhanceAlerts);
window.addEventListener('load', maybeEnhanceAlerts);
window.setInterval(() => {
  if (document.querySelector('.citizen-alerts-screen')) void refreshLiveData(true);
}, 15_000);
maybeEnhanceAlerts();
