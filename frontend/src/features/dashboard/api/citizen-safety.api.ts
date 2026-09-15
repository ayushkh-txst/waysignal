import { apiRequest } from '../../../lib/api-client';
import { screenEvacuationRoute } from './route-screening';
import { authSession } from '../../auth/auth-session';

export type SafetyContext = {
  latitude: number;
  longitude: number;
  observed_at: string;
  source: string;
  temperature_c: number | null;
  precipitation_next_6h_mm: number;
  precipitation_probability_max_6h: number | null;
  river_discharge_m3s: number | null;
  river_discharge_tomorrow_m3s: number | null;
  river_trend_percent: number | null;
  prototype_risk_score: number;
  prototype_risk_level: 'low' | 'moderate' | 'high' | 'critical';
};

export type EmergencyType = 'rescue' | 'medical' | 'evacuation';
export type EmergencyStatus = 'submitted' | 'assigned' | 'en_route' | 'resolved' | 'cancelled';

export type EmergencyCreate = {
  citizen_id: string;
  citizen_name: string;
  emergency_type: EmergencyType;
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  people_count: number;
  notes: string;
  risk_score?: number | null;
  risk_level?: string | null;
  precipitation_next_6h_mm?: number | null;
  river_discharge_m3s?: number | null;
};

export type EmergencyRecord = EmergencyCreate & {
  id: string;
  status: EmergencyStatus;
  created_at: string;
  updated_at?: string | null;
  responder_id?: string | null;
  responder_name?: string | null;
  is_demo?: boolean;
  navigation_status?: 'assigned' | 'en_route' | 'approaching' | 'on_scene' | 'resolved' | null;
  responder_latitude?: number | null;
  responder_longitude?: number | null;
  recommended_route?: Record<string, unknown> | null;
  responder_eta_seconds?: number | null;
  responder_distance_m?: number | null;
  eta_updated_at?: string | null;
  route_updated_at?: string | null;
  reroute_reason?: string | null;
  acknowledged_at?: string | null;
  assigned_at?: string | null;
  en_route_at?: string | null;
  on_scene_at?: string | null;
  resolved_at?: string | null;
  location_updated_at?: string | null;
};

export type EmergencyNavigationUpdate = {
  responder_latitude: number;
  responder_longitude: number;
  recommended_route?: Record<string, unknown> | null;
  responder_eta_seconds?: number | null;
  responder_distance_m?: number | null;
  navigation_status: 'assigned' | 'en_route' | 'approaching' | 'on_scene' | 'resolved';
  reroute_reason?: string | null;
};

export type EmergencyLocationUpdate = {
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
};

export type EmergencyListFilters = {
  status?: EmergencyStatus;
  is_demo?: boolean;
};

export type EvacuationRouteStep = {
  instruction: string;
  distance_m: number;
  duration_s: number;
};

export type ScreenedRoute = {
  id?: string;
  status: 'rejected' | 'viable' | 'recommended';
  distance_m?: number;
  duration_s?: number;
  prototype_safety_score?: number;
  rejection_reasons?: string[];
  geometry?: number[][];
};

export type EvacuationRoute = {
  destination_name: string;
  destination_type: string;
  destination_latitude: number;
  destination_longitude: number;
  distance_m: number;
  duration_s: number;
  geometry: number[][];
  steps: EvacuationRouteStep[];
  alternatives_considered: number;
  rejected_count?: number;
  viable_count?: number;
  recommended_count?: number;
  screening_status?: 'pending' | 'complete';
  screened_routes?: ScreenedRoute[];
  prototype_safety_score: number;
  reasons: string[];
  source: string;
  warning: string;
};

const routeRequests = new Map<string, Promise<EvacuationRoute>>();
const routeKey = (latitude: number, longitude: number) => `${latitude.toFixed(3)},${longitude.toFixed(3)}`;

function publishRouteAnalysis(route: EvacuationRoute) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<EvacuationRoute>('jalrakshak:route-analysis', { detail: route }));
}

function emergencyListPath(filters?: EmergencyListFilters) {
  if (!filters || (filters.status === undefined && filters.is_demo === undefined)) return '/emergencies';
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (typeof filters.is_demo === 'boolean') params.set('is_demo', String(filters.is_demo));
  const query = params.toString();
  return query ? `/emergencies?${query}` : '/emergencies';
}

export const citizenSafetyApi = {
  getContext(latitude: number, longitude: number): Promise<SafetyContext> {
    const params = new URLSearchParams({ latitude: latitude.toString(), longitude: longitude.toString() });
    return apiRequest<SafetyContext>(`/safety/context?${params.toString()}`);
  },
  getEvacuationRoute(latitude: number, longitude: number): Promise<EvacuationRoute> {
    const key = routeKey(latitude, longitude);
    const existing = routeRequests.get(key);
    if (existing) return existing;

    const params = new URLSearchParams({ latitude: latitude.toString(), longitude: longitude.toString() });
    const request = apiRequest<EvacuationRoute>(`/routing/evacuation?${params.toString()}`, undefined, 15_000)
      .then(async (route) => {
        publishRouteAnalysis({ ...route, screening_status: 'pending', recommended_count: 0 });
        const screenedRoute = await screenEvacuationRoute(latitude, longitude, route);
        publishRouteAnalysis(screenedRoute);
        return screenedRoute;
      })
      .finally(() => routeRequests.delete(key));
    routeRequests.set(key, request);
    return request;
  },
  createEmergency(payload: EmergencyCreate): Promise<EmergencyRecord> {
    return apiRequest<EmergencyRecord>('/emergencies', { method: 'POST', body: JSON.stringify(payload) });
  },
  getEmergency(id: string): Promise<EmergencyRecord> {
    return apiRequest<EmergencyRecord>(`/emergencies/${id}`);
  },
  acknowledgeEmergency(id: string): Promise<EmergencyRecord> {
    const token = authSession.get()?.access_token;
    return apiRequest<EmergencyRecord>(`/emergencies/${id}/acknowledge`, { method: 'POST', headers: { Authorization: `Bearer ${token ?? ''}` } });
  },
  listEmergencies(filters?: EmergencyListFilters): Promise<EmergencyRecord[]> {
    return apiRequest<EmergencyRecord[]>(emergencyListPath(filters));
  },
  updateEmergency(id: string, payload: { status: EmergencyStatus; responder_id?: string; responder_name?: string }): Promise<EmergencyRecord> {
    return apiRequest<EmergencyRecord>(`/emergencies/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  updateEmergencyLocation(id: string, payload: EmergencyLocationUpdate): Promise<EmergencyRecord> {
    return apiRequest<EmergencyRecord>(`/emergencies/${id}/location`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  updateEmergencyNavigation(id: string, payload: EmergencyNavigationUpdate): Promise<EmergencyRecord> {
    return apiRequest<EmergencyRecord>(`/emergencies/${id}/navigation`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  cancelEmergency(id: string): Promise<EmergencyRecord> {
    return apiRequest<EmergencyRecord>(`/emergencies/${id}/cancel`, { method: 'POST' });
  },
};
