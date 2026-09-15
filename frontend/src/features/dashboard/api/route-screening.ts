import type { EvacuationRoute, ScreenedRoute } from './citizen-safety.api';
import { hazardsApi, type HazardReport as UserHazardReport } from './hazards.api';

type LatLon = [number, number];
type HazardSeverity = 'high' | 'critical';
type HazardPolygon = { id: string; severity: HazardSeverity; label: string; points: LatLon[] };
type OsrmStep = {
  distance: number;
  duration: number;
  name?: string;
  maneuver?: { instruction?: string; type?: string; modifier?: string };
};
type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs?: Array<{ steps?: OsrmStep[] }>;
};

type CandidateResult = ScreenedRoute & { routeSteps: EvacuationRoute['steps'] };

const TEXAS_DEMO_CENTER: LatLon = [29.7604, -95.3698];
const MAX_SCREENING_MS = 2600;

// Prototype Houston-area hazard polygons for the hackathon demo. These are explicitly
// modeled demo zones, not official flood-depth or road-closure data.
const DEMO_HAZARDS: HazardPolygon[] = [
  {
    id: 'houston-critical-buffalo-bayou',
    severity: 'critical',
    label: 'Modeled Buffalo Bayou flood zone',
    points: [[29.7588,-95.4050],[29.7685,-95.3970],[29.7698,-95.3770],[29.7620,-95.3655],[29.7535,-95.3760],[29.7520,-95.3940]],
  },
  {
    id: 'houston-high-brays-bayou',
    severity: 'high',
    label: 'Modeled Brays Bayou high-risk zone',
    points: [[29.7105,-95.4250],[29.7215,-95.4170],[29.7240,-95.3920],[29.7165,-95.3760],[29.7050,-95.3890],[29.7035,-95.4100]],
  },
];

const nearTexasDemo = (lat: number, lon: number) => Math.abs(lat - TEXAS_DEMO_CENTER[0]) < 1.2 && Math.abs(lon - TEXAS_DEMO_CENTER[1]) < 1.2;

export function loadRecentUserHazards(): UserHazardReport[] {
  return hazardsApi.snapshot().reports;
}

function pointInPolygon(point: LatLon, polygon: LatLon[]): boolean {
  const [lat, lon] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lonI] = polygon[i];
    const [latJ, lonJ] = polygon[j];
    const intersects = ((lonI > lon) !== (lonJ > lon)) &&
      (lat < ((latJ - latI) * (lon - lonI)) / ((lonJ - lonI) || Number.EPSILON) + latI);
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(a: LatLon, b: LatLon, c: LatLon): number {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}

function segmentsIntersect(a: LatLon, b: LatLon, c: LatLon, d: LatLon): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (o1 === 0 || o2 === 0 || o1 * o2 < 0) && (o3 === 0 || o4 === 0 || o3 * o4 < 0);
}

function routeIntersectsPolygon(route: LatLon[], polygon: LatLon[]): boolean {
  if (route.some(point => pointInPolygon(point, polygon))) return true;
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    for (let j = 0; j < polygon.length; j += 1) {
      const c = polygon[j];
      const d = polygon[(j + 1) % polygon.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function distanceMeters(a: LatLon, b: LatLon): number {
  const earth = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

function reportRadiusMeters(report: UserHazardReport): number {
  const base = report.kind === 'flooded_road' ? 110 : report.kind === 'road_blocked' ? 85 : report.kind === 'debris' ? 60 : 55;
  const accuracy = Number.isFinite(report.accuracy_m) ? Math.max(0, Number(report.accuracy_m)) : 0;
  return Math.min(180, base + Math.min(accuracy, 50));
}

function routeNearUserReport(route: LatLon[], report: UserHazardReport): boolean {
  const point: LatLon = [report.latitude, report.longitude];
  const radius = reportRadiusMeters(report);
  if (route.some(routePoint => distanceMeters(routePoint, point) <= radius)) return true;
  // Screen the segments too: a blockage may fall between sparse OSRM vertices.
  const scale = Math.cos(point[0] * Math.PI / 180);
  const project = ([lat, lon]: LatLon) => [(lon - point[1]) * 111_195 * scale, (lat - point[0]) * 111_195];
  for (let i = 1; i < route.length; i++) {
    const [ax, ay] = project(route[i - 1]), [bx, by] = project(route[i]);
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(ax + t * dx, ay + t * dy) <= radius) return true;
  }
  return false;
}

async function fetchAlternatives(originLat: number, originLon: number, route: EvacuationRoute): Promise<OsrmRoute[]> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), MAX_SCREENING_MS);
  try {
    const coords = `${originLon},${originLat};${route.destination_longitude},${route.destination_latitude}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?alternatives=true&overview=full&geometries=geojson&steps=true`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('OSRM alternative-route lookup failed');
    const payload = await response.json() as { routes?: OsrmRoute[] };
    return payload.routes ?? [];
  } finally {
    window.clearTimeout(timer);
  }
}

function geometryToLatLon(route: OsrmRoute): LatLon[] {
  return route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}

function instructionForStep(step: OsrmStep, index: number): string {
  const provided = step.maneuver?.instruction?.trim();
  if (provided) return provided;
  const name = step.name?.trim();
  const type = step.maneuver?.type?.replace(/_/g, ' ').trim();
  const modifier = step.maneuver?.modifier?.replace(/_/g, ' ').trim();
  const pieces = [type, modifier, name ? `onto ${name}` : ''].filter(Boolean);
  return pieces.length ? pieces.join(' ') : `Continue on the recommended route (${index + 1})`;
}

function routeSteps(route: OsrmRoute): EvacuationRoute['steps'] {
  const steps = route.legs?.flatMap(leg => leg.steps ?? []) ?? [];
  return steps.filter(step => step.distance > 1 || step.duration > 1).map((step, index) => ({
    instruction: instructionForStep(step, index), distance_m: step.distance, duration_s: step.duration,
  }));
}

function screenCandidate(route: OsrmRoute, hazards: HazardPolygon[], userReports: UserHazardReport[], index: number): CandidateResult {
  const geometry = geometryToLatLon(route);
  const rejectionReasons: string[] = [];
  let highRiskTouches = 0;
  for (const hazard of hazards) {
    if (!routeIntersectsPolygon(geometry, hazard.points)) continue;
    if (hazard.severity === 'critical') rejectionReasons.push(`Crosses ${hazard.label.toLowerCase()}`);
    else highRiskTouches += 1;
  }
  for (const report of userReports) {
    if (routeNearUserReport(geometry, report)) rejectionReasons.push(`Passes near user-reported ${report.label.toLowerCase()} (${report.id})`);
  }
  const status: ScreenedRoute['status'] = rejectionReasons.length ? 'rejected' : 'viable';
  const safetyPenalty = rejectionReasons.length * 70 + highRiskTouches * 18;
  return { id: `candidate-${index + 1}`, status, distance_m: route.distance, duration_s: route.duration, prototype_safety_score: Math.max(5, 100 - safetyPenalty), rejection_reasons: rejectionReasons, geometry, routeSteps: routeSteps(route) };
}

export async function screenEvacuationRoute(originLat: number, originLon: number, route: EvacuationRoute, options: { includeDemoHazards?: boolean } = {}): Promise<EvacuationRoute> {
  try {
    const [osrmRoutes, userReports] = await Promise.all([
      fetchAlternatives(originLat, originLon, route), hazardsApi.refresh(),
    ]);
    if (!osrmRoutes.length) throw new Error('No road alternatives available.');
    // Live maps use shared backend reports. Demo polygons require explicit opt-in;
    // otherwise routing would reject invisible fictional areas on the citizen map.
    const hazards = options.includeDemoHazards && nearTexasDemo(originLat, originLon) ? DEMO_HAZARDS : [];
    const screened = osrmRoutes.map((candidate, index) => screenCandidate(candidate, hazards, userReports, index));
    const viable = screened.filter(candidate => candidate.status === 'viable');
    const rejected = screened.filter(candidate => candidate.status === 'rejected');

    let recommended: CandidateResult | null = null;
    if (viable.length) {
      recommended = viable.reduce((best, candidate) => {
        const bestScore = (best.prototype_safety_score ?? 0) * 100000 - (best.duration_s ?? Number.MAX_SAFE_INTEGER);
        const candidateScore = (candidate.prototype_safety_score ?? 0) * 100000 - (candidate.duration_s ?? Number.MAX_SAFE_INTEGER);
        return candidateScore > bestScore ? candidate : best;
      }) as CandidateResult;
      recommended.status = 'recommended';
    }

    const userReportReason = userReports.length
      ? `Also screened against ${userReports.length} active backend hazard report${userReports.length === 1 ? '' : 's'}. These reports are unverified and are used conservatively to avoid nearby road segments until a responder resolves them.`
      : 'The shared backend returned no active user-reported hazards.';

    if (!recommended) {
      return { ...route, alternatives_considered: screened.length, rejected_count: rejected.length, viable_count: 0, recommended_count: 0, screening_status: 'complete', screened_routes: screened, reasons: [...route.reasons, `All ${screened.length} available road alternatives were rejected by the current prototype safety screen.`, userReportReason], warning: 'No route is currently recommended. User reports are not official closures, and modeled hazards are prototype data. Do not claim a road is safe when every candidate is rejected.' };
    }

    const recommendedSteps = recommended.routeSteps.length ? recommended.routeSteps : route.steps;
    return {
      ...route,
      geometry: recommended.geometry ?? route.geometry,
      distance_m: recommended.distance_m ?? route.distance_m,
      duration_s: recommended.duration_s ?? route.duration_s,
      steps: recommendedSteps,
      prototype_safety_score: recommended.prototype_safety_score ?? route.prototype_safety_score,
      alternatives_considered: screened.length,
      rejected_count: rejected.length,
      viable_count: viable.length,
      recommended_count: 1,
      screening_status: 'complete',
      screened_routes: screened,
      reasons: [
        ...route.reasons,
        hazards.length ? `Screened ${screened.length} road alternatives against Houston-area modeled hazard polygons.` : `Screened ${screened.length} real road alternatives for the current location.`,
        userReportReason,
        rejected.length ? `${rejected.length} route${rejected.length === 1 ? ' was' : 's were'} rejected; the safest remaining viable alternative is now the recommended route.` : 'No candidate route intersected the currently configured hazard exclusions.',
      ],
      warning: userReports.length
        ? 'Route screening includes recent user-reported hazards. Those reports are not official road-closure confirmations, so the route remains a prototype safety recommendation.'
        : hazards.length
          ? 'Route rejection uses modeled Houston-area prototype hazard polygons and should not be treated as an official road-closure or flood-depth determination.'
          : 'Road alternatives are real OSRM routes, but no official flood/closure geometry is configured for this location. Screening therefore cannot claim a road is flood-safe.',
    };
  } catch {
    return { ...route, screening_status: 'pending', recommended_count: 0, viable_count: 0,
      screened_routes: [], warning: 'Shared hazards or road routing are unavailable. No route is currently recommended; retry screening before travel.' };
  }
}
