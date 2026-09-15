import { apiRequest } from '../../../lib/api-client';
import { authSession } from '../../auth/auth-session';

export type DispatchItem = {
  incident_id: string; revision: string; emergency_type: string; people_count: number;
  latitude: number; longitude: number; title: string; summary: string; suggested_services: string[];
  risk_context: string; status: string; created_at: string; reviewed: boolean;
};
export type DispatchContact = {
  id: string; name: string; phone: string; services: string[]; coverage: string;
  source_url: string; checked_on: string; note: string; short_code: boolean; emergency: boolean;
};
export type DispatchDetail = DispatchItem & {
  location: { label: string; country: string | null; city: string; region: string; source: string };
  directory: { country: string | null; selection: string; contacts: DispatchContact[]; notice: string; coverage_notice: string };
  notes: string; accuracy_m: number | null; location_age_seconds: number; location_stale: boolean;
  ai_available: boolean; summary_source: string; handoff: string;
};
export type AIReview = { revision: string; status: 'complete' | 'unavailable' | 'not_configured' | 'no_notes'; signals: { kind: string; evidence: string }[]; notice: string };

function options(method = 'GET', body?: unknown): RequestInit {
  const token = authSession.get()?.access_token;
  return { method, cache: 'no-store', headers: { Authorization: `Bearer ${token ?? ''}` }, ...(body ? { body: JSON.stringify(body) } : {}) };
}
export const dispatchApi = {
  list: () => apiRequest<{ items: DispatchItem[]; unread_count: number; checked_at: string }>('/admin/dispatch/notifications', options()),
  detail: (id: string, directory = '') => apiRequest<DispatchDetail>(`/admin/dispatch/incidents/${encodeURIComponent(id)}${directory ? `?directory=${directory}` : ''}`, options()),
  review: (item: DispatchItem) => apiRequest(`/admin/dispatch/incidents/${encodeURIComponent(item.incident_id)}/review`, options('POST', { revision: item.revision })),
  aiReview: (item: DispatchItem) => apiRequest<AIReview>(`/admin/dispatch/incidents/${encodeURIComponent(item.incident_id)}/ai-review`, options('POST', { revision: item.revision }), 12_000),
};
