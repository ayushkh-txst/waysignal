import { apiRequest } from '../../../lib/api-client';
import { citizenSafetyApi, type EmergencyRecord } from './citizen-safety.api';

export type RiskBand = 'low' | 'moderate' | 'high' | 'critical';
export type DistrictId = 'harris' | 'fort_bend' | 'brazoria' | 'galveston';

export type DistrictSummary = {
  id: DistrictId;
  name: string;
  shortName: string;
  riskScore: number;
  riskBand: RiskBand;
  incidentCount: number;
  peopleAtRisk: number;
  activeResponders: number;
  safeZoneLoad: number;
  center: { lat: number; lng: number };
};

export type DistrictIncident = {
  id: string;
  type: 'rescue' | 'medical' | 'evacuation';
  priority: RiskBand;
  people: number;
  risk: number;
  ageLabel: string;
  accuracyLabel: string;
  status: string;
  latitude: number;
  longitude: number;
};

export type SafeZone = {
  id: string;
  name: string;
  distanceLabel: string;
  occupancy: number;
  capacity: number;
  status: 'recommended' | 'near_capacity' | 'available';
};

export type ResponderStatus = {
  id: string;
  name: string;
  status: 'available' | 'assigned' | 'en_route';
  incidentId?: string;
};

export type DistrictOperations = DistrictSummary & {
  factors: Array<{ label: string; value: number }>;
  incidents: DistrictIncident[];
  safeZones: SafeZone[];
  responders: ResponderStatus[];
};

export type AdminDashboardOverview = {
  source: 'live' | 'hybrid';
  updatedAt: string;
  criticalDistricts: number;
  activeIncidents: number;
  peopleAtRisk: number;
  activeResponders: number;
  districts: DistrictSummary[];
  riskTrend: Array<{ label: string; value: number }>;
  safeZoneCapacity: { total: number; assigned: number; available: number; loadPercent: number };
};

const HYBRID_DISTRICTS: Record<DistrictId, DistrictOperations> = {
  harris: {
    id: 'harris', name: 'Harris County', shortName: 'Harris', riskScore: 86, riskBand: 'critical', incidentCount: 6, peopleAtRisk: 412, activeResponders: 12, safeZoneLoad: 64,
    center: { lat: 29.7604, lng: -95.3698 },
    factors: [{ label: 'Forecast rainfall', value: 86 }, { label: 'Bayou / river rise', value: 81 }, { label: 'Recent rainfall', value: 78 }, { label: 'Low-lying exposure', value: 74 }],
    incidents: [
      { id: 'HOU-1042', type: 'rescue', priority: 'critical', people: 3, risk: 91, ageLabel: '22 sec', accuracyLabel: '±11m', status: 'submitted', latitude: 29.7179, longitude: -95.4020 },
      { id: 'HOU-1048', type: 'medical', priority: 'high', people: 1, risk: 82, ageLabel: '1 min', accuracyLabel: '±18m', status: 'assigned', latitude: 29.735, longitude: -95.390 },
      { id: 'HOU-1051', type: 'evacuation', priority: 'high', people: 5, risk: 77, ageLabel: '36 sec', accuracyLabel: '±14m', status: 'en_route', latitude: 29.748, longitude: -95.365 },
    ],
    safeZones: [
      { id: 'sz-h1', name: 'NRG Park — modeled safe zone', distanceLabel: '2.4 mi', occupancy: 640, capacity: 1000, status: 'recommended' },
      { id: 'sz-h2', name: 'George R. Brown Area — modeled safe zone', distanceLabel: '4.8 mi', occupancy: 760, capacity: 820, status: 'near_capacity' },
      { id: 'sz-h3', name: 'Rice University Area — modeled safe zone', distanceLabel: '1.6 mi', occupancy: 250, capacity: 700, status: 'available' },
    ],
    responders: [
      { id: 'hr1', name: 'Unit H-12', status: 'en_route', incidentId: 'HOU-1042' }, { id: 'hr2', name: 'Unit H-07', status: 'available' }, { id: 'hr3', name: 'Unit H-21', status: 'assigned', incidentId: 'HOU-1048' }, { id: 'hr4', name: 'Unit H-18', status: 'en_route', incidentId: 'HOU-1051' }, { id: 'hr5', name: 'Unit H-04', status: 'available' },
    ],
  },
  fort_bend: {
    id: 'fort_bend', name: 'Fort Bend County', shortName: 'Fort Bend', riskScore: 73, riskBand: 'high', incidentCount: 4, peopleAtRisk: 258, activeResponders: 8, safeZoneLoad: 52,
    center: { lat: 29.5274, lng: -95.7701 },
    factors: [{ label: 'Forecast rainfall', value: 73 }, { label: 'Brazos River rise', value: 77 }, { label: 'Recent rainfall', value: 66 }, { label: 'Low-lying exposure', value: 58 }],
    incidents: [{ id: 'FB-2031', type: 'evacuation', priority: 'high', people: 8, risk: 79, ageLabel: '48 sec', accuracyLabel: '±15m', status: 'submitted', latitude: 29.56, longitude: -95.74 }],
    safeZones: [{ id: 'sz-f1', name: 'Fort Bend Fairgrounds — modeled safe zone', distanceLabel: '3.1 mi', occupancy: 330, capacity: 620, status: 'recommended' }, { id: 'sz-f2', name: 'Sugar Land Civic Area — modeled safe zone', distanceLabel: '5.0 mi', occupancy: 260, capacity: 300, status: 'near_capacity' }],
    responders: [{ id: 'fr1', name: 'Unit FB-03', status: 'en_route', incidentId: 'FB-2031' }, { id: 'fr2', name: 'Unit FB-11', status: 'available' }],
  },
  brazoria: {
    id: 'brazoria', name: 'Brazoria County', shortName: 'Brazoria', riskScore: 68, riskBand: 'high', incidentCount: 3, peopleAtRisk: 186, activeResponders: 6, safeZoneLoad: 45,
    center: { lat: 29.1672, lng: -95.4342 },
    factors: [{ label: 'Forecast rainfall', value: 68 }, { label: 'Brazos / drainage rise', value: 71 }, { label: 'Recent rainfall', value: 63 }, { label: 'Coastal exposure', value: 61 }],
    incidents: [{ id: 'BZ-3014', type: 'medical', priority: 'high', people: 2, risk: 72, ageLabel: '2 min', accuracyLabel: '±20m', status: 'assigned', latitude: 29.20, longitude: -95.42 }],
    safeZones: [{ id: 'sz-b1', name: 'Angleton Area — modeled safe zone', distanceLabel: '2.8 mi', occupancy: 210, capacity: 520, status: 'recommended' }],
    responders: [{ id: 'br1', name: 'Unit BZ-09', status: 'assigned', incidentId: 'BZ-3014' }, { id: 'br2', name: 'Unit BZ-06', status: 'available' }],
  },
  galveston: {
    id: 'galveston', name: 'Galveston County', shortName: 'Galveston', riskScore: 59, riskBand: 'moderate', incidentCount: 2, peopleAtRisk: 121, activeResponders: 5, safeZoneLoad: 38,
    center: { lat: 29.3013, lng: -94.7977 },
    factors: [{ label: 'Forecast rainfall', value: 59 }, { label: 'Tidal / surge exposure', value: 64 }, { label: 'Recent rainfall', value: 48 }, { label: 'Coastal exposure', value: 72 }],
    incidents: [{ id: 'GAL-4012', type: 'medical', priority: 'moderate', people: 1, risk: 58, ageLabel: '4 min', accuracyLabel: '±12m', status: 'submitted', latitude: 29.31, longitude: -94.80 }],
    safeZones: [{ id: 'sz-g1', name: 'Texas City Area — modeled safe zone', distanceLabel: '7.2 mi', occupancy: 140, capacity: 420, status: 'recommended' }],
    responders: [{ id: 'gr1', name: 'Unit G-05', status: 'available' }, { id: 'gr2', name: 'Unit G-14', status: 'assigned', incidentId: 'GAL-4012' }],
  },
};

function ageLabel(createdAt: string) {
  const sec = Math.max(0, Math.round((Date.now() - Date.parse(createdAt)) / 1000));
  if (sec < 60) return `${sec} sec`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} hr`;
}

function nearestDistrict(record: EmergencyRecord): DistrictId | null {
  const candidates = Object.values(HYBRID_DISTRICTS).map((d) => ({ id: d.id, delta: Math.hypot(record.latitude - d.center.lat, record.longitude - d.center.lng) }));
  candidates.sort((a, b) => a.delta - b.delta);
  return candidates[0] && candidates[0].delta < 1.35 ? candidates[0].id : null;
}

function emergencyToDistrictIncident(record: EmergencyRecord): DistrictIncident {
  const risk = Number(record.risk_score ?? 0);
  const priority: RiskBand = risk >= 80 ? 'critical' : risk >= 60 ? 'high' : risk >= 35 ? 'moderate' : 'low';
  return { id: record.id, type: record.emergency_type, priority, people: record.people_count, risk, ageLabel: ageLabel(record.created_at), accuracyLabel: record.accuracy_m != null ? `±${Math.round(record.accuracy_m)}m` : '—', status: record.status, latitude: record.latitude, longitude: record.longitude };
}

async function getEmergencyRecordsSafe() {
  try { return await citizenSafetyApi.listEmergencies(); } catch { return [] as EmergencyRecord[]; }
}

export const adminDashboardApi = {
  async getOverview(): Promise<AdminDashboardOverview> {
    try {
      return await apiRequest<AdminDashboardOverview>('/admin/dashboard/overview', undefined, 2500);
    } catch {
      const records = await getEmergencyRecordsSafe();
      const active = records.filter((r) => r.status !== 'resolved' && r.status !== 'cancelled');
      const realPeople = active.reduce((sum, r) => sum + Math.max(1, Number(r.people_count || 1)), 0);
      const assignedResponders = new Set(active.map((r) => r.responder_id).filter(Boolean)).size;
      const districts = Object.values(HYBRID_DISTRICTS).map((d) => ({ ...d }));
      const modeledPeople = districts.reduce((s, d) => s + d.peopleAtRisk, 0);
      const modeledResponders = districts.reduce((s, d) => s + d.activeResponders, 0);
      const totalCapacity = 3860;
      const assigned = realPeople || modeledPeople;
      return {
        source: 'hybrid', updatedAt: new Date().toISOString(), criticalDistricts: districts.filter((d) => d.riskBand === 'critical').length,
        activeIncidents: active.length || districts.reduce((s, d) => s + d.incidentCount, 0), peopleAtRisk: realPeople || modeledPeople,
        activeResponders: assignedResponders || modeledResponders, districts,
        riskTrend: [{ label: '-4h', value: 44 }, { label: '-3h', value: 53 }, { label: '-2h', value: 61 }, { label: '-1h', value: 72 }, { label: 'now', value: 79 }],
        safeZoneCapacity: { total: totalCapacity, assigned, available: Math.max(0, totalCapacity - assigned), loadPercent: Math.round((assigned / totalCapacity) * 100) },
      };
    }
  },

  async getDistrict(id: DistrictId): Promise<DistrictOperations> {
    try {
      return await apiRequest<DistrictOperations>(`/admin/dashboard/districts/${id}`, undefined, 2500);
    } catch {
      const base = structuredClone(HYBRID_DISTRICTS[id]);
      const records = await getEmergencyRecordsSafe();
      const districtRecords = records.filter((r) => r.status !== 'cancelled' && nearestDistrict(r) === id);
      if (districtRecords.length) {
        const active = districtRecords.filter((r) => r.status !== 'resolved');
        base.incidents = [...active.map(emergencyToDistrictIncident), ...base.incidents].slice(0, 8);
        base.incidentCount = active.length || base.incidentCount;
        base.peopleAtRisk = active.length ? active.reduce((sum, r) => sum + Math.max(1, r.people_count), 0) : base.peopleAtRisk;
        base.activeResponders = new Set(active.map((r) => r.responder_id).filter(Boolean)).size || base.activeResponders;
      }
      return base;
    }
  },
};
