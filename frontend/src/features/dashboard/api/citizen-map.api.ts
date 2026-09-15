import { apiRequest } from '../../../lib/api-client';
import { authSession } from '../../auth/auth-session';
import type { EmergencyRecord } from './citizen-safety.api';

export type MapPoint = { latitude: number; longitude: number };
export type MapPlaceLabel = { primary: string; secondary: string; source?: string };
export type MapFacility = MapPoint & { id: string; name: string; kind: string; shelter_verified: boolean };
export type MapPlaces = MapPoint & {
  retrieved_at: string; location: MapPlaceLabel; facilities: MapFacility[];
  facilities_status: 'available' | 'unavailable'; facilities_source: string; radius_m: number; notice: string;
};
function headers() {
  const token = authSession.get()?.access_token;
  if (!token) throw new Error('Sign in to load your map data.');
  return { Authorization: `Bearer ${token}` };
}
export const citizenMapApi = {
  places: ({ latitude, longitude }: MapPoint) => apiRequest<MapPlaces>(
    `/citizen-map/places?${new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) })}`,
    { headers: headers(), cache: 'no-store' }, 12000,
  ),
  incidents: () => apiRequest<EmergencyRecord[]>('/citizen-map/incidents', { headers: headers(), cache: 'no-store' }),
};
