import { apiRequest, ApiError, API_BASE_URL } from '../../../lib/api-client';
import { authSession } from '../../auth/auth-session';

export type ReportFilters = { start_date: string; end_date: string; timezone_name: string; severity: string; incident_type: string; status: string; location: string; page: number };
export type Measurement = { seconds: number | null; samples: number };
export type ReportRow = { id: string; incident_type: string; status: string; people_count: number; severity: string; risk_score: number | null; location: string; created_at: string; acknowledged_at: string | null; assigned_at: string | null; resolved_at: string | null; location_updated_at: string | null; accuracy_m: number | null; assignment_seconds: number | null; resolution_seconds: number | null };
export type ReportsData = {
  generated_at: string; source: string; demo_excluded: boolean; filters: ReportFilters; locations: string[];
  summary: { total: number; critical: number; active: number; resolved: number; cancelled: number; resolution_percent: number | null; people_in_resolved: number; people_in_active: number };
  timings: Record<'acknowledgment' | 'assignment' | 'dispatch' | 'arrival' | 'resolution', Measurement>;
  trend: Array<{ date: string; total: number; critical: number; high: number; moderate: number; low: number; unknown: number }>;
  severity: Array<{ key: string; count: number }>; incident_types: Array<{ key: string; count: number }>; statuses: Array<{ key: string; count: number }>;
  locations_summary: Array<{ location: string; incidents: number; active_people: number; resolved: number; max_risk_score: number | null; assignment: Measurement; safe_zone_load: null }>;
  location_quality: { total: number; counts: Record<string, number>; average_accuracy_m: number | null; accuracy_samples: number; stale_after_seconds: number };
  evacuation: { incidents: number; people: number; resolved: number; active_people: number };
  unavailable: Record<string, string>; page: number; page_count: number; rows: ReportRow[];
};

export function reportQuery(filters: ReportFilters) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== '') query.set(key, String(value)); });
  return query.toString();
}

function headers() {
  const token = authSession.get()?.access_token;
  if (!token) throw new ApiError(401, 'Sign in again to open reports.');
  return { Authorization: `Bearer ${token}` };
}

export const reportsApi = {
  get(filters: ReportFilters) {
    return apiRequest<ReportsData>(`/admin/reports?${reportQuery(filters)}`, { headers: headers() });
  },
  async export(filters: ReportFilters) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${API_BASE_URL}/admin/reports/export?${reportQuery(filters)}`, {
        headers: headers(), credentials: 'include', signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to export reports.' : 'Report export failed. Please retry.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `jalrakshak-reports-${filters.start_date}-${filters.end_date}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally { window.clearTimeout(timeout); }
  },
};
