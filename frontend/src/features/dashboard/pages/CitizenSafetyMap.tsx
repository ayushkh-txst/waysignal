import { useEffect, useRef, useState } from 'react';
import { loadLeaflet } from '../../../lib/load-leaflet';
import { citizenMapApi, type MapPlaces, type MapPoint, type MapPlaceLabel } from '../api/citizen-map.api';
import type { EmergencyRecord, EvacuationRoute } from '../api/citizen-safety.api';
import { hazardsApi } from '../api/hazards.api';
import { attachSharedHazards, setSharedHazardsVisible } from '../user-hazard-map-enhancer';
import './CitizenSafetyMap.css';

type Layer = 'hazards' | 'incidents' | 'facilities' | 'responders' | 'routes';
type Host = HTMLDivElement & { citizenMap?: { map: any; L: any } };
const pointValid = (lat: unknown, lon: unknown) => typeof lat === 'number' && typeof lon === 'number'
  && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const geometryValid = (value: unknown): value is [number, number][] => Array.isArray(value)
  && value.length > 1 && value.every(p => Array.isArray(p) && pointValid(p[0], p[1]));
function popup(title: string, detail: string) {
  const root = document.createElement('div');
  const strong = document.createElement('strong'); strong.textContent = title;
  const body = document.createElement('p'); body.textContent = detail;
  root.append(strong, body); return root;
}

export default function CitizenSafetyMap({ center, hasLocation, guidanceActive, route, onPlaceLabel }: {
  center: MapPoint; hasLocation: boolean; guidanceActive: boolean; route: EvacuationRoute | null;
  onPlaceLabel: (label: MapPlaceLabel) => void;
}) {
  const host = useRef<Host | null>(null);
  const current = useRef({ center, hasLocation, onPlaceLabel });
  current.current = { center, hasLocation, onPlaceLabel };
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [mapError, setMapError] = useState('');
  const [places, setPlaces] = useState<MapPlaces | null>(null);
  const [placesError, setPlacesError] = useState('');
  const [placesLoading, setPlacesLoading] = useState(true);
  const [incidents, setIncidents] = useState<EmergencyRecord[]>([]);
  const [incidentError, setIncidentError] = useState('');
  const [incidentChecked, setIncidentChecked] = useState<string | null>(null);
  const [hazards, setHazards] = useState(hazardsApi.snapshot());
  const [visible, setVisible] = useState<Record<Layer, boolean>>({ hazards: true, incidents: true, facilities: true, responders: true, routes: true });
  const [comparisons, setComparisons] = useState(false);
  const drawn = useRef<any>(null);
  const fitted = useRef('');

  useEffect(() => hazardsApi.subscribe(setHazards), []);
  useEffect(() => {
    let disposed = false;
    let map: any;
    let resize: ResizeObserver | undefined;
    const element = host.current;
    setReady(false); setMapError(''); fitted.current = '';
    loadLeaflet().then(L => {
      if (disposed || !element) return;
      const origin = current.current.center;
      map = L.map(element, { zoomControl: true, attributionControl: true, scrollWheelZoom: true,
        zoomAnimation: false, markerZoomAnimation: false })
        .setView([origin.latitude, origin.longitude], current.current.hasLocation ? 14 : 12);
      element.citizenMap = { map, L };
      attachSharedHazards(map, L);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on('tileerror', () => { if (!disposed) setMapError('Street tiles are unavailable. Location markers still use their recorded coordinates.'); }).addTo(map);
      L.control.scale({ imperial: false }).addTo(map);
      resize = new ResizeObserver(() => { if (!disposed) map.invalidateSize(); }); resize.observe(element);
      setReady(true);
    }).catch(error => { if (!disposed) setMapError(error instanceof Error ? error.message : 'Map unavailable.'); });
    return () => { disposed = true; resize?.disconnect(); drawn.current = null;
      if (element && element.citizenMap?.map === map) delete element.citizenMap;
      map?.remove();
    };
  }, [attempt]);

  useEffect(() => {
    const view = host.current?.citizenMap;
    if (ready && view) view.map.setView([center.latitude, center.longitude], hasLocation ? 14 : 12);
  }, [ready, center.latitude, center.longitude, hasLocation]);

  useEffect(() => {
    let active = true;
    setPlaces(null); setPlacesError(''); setPlacesLoading(true);
    citizenMapApi.places(center).then(data => {
      if (!active) return;
      setPlaces(data); current.current.onPlaceLabel(data.location);
    }).catch(error => { if (active) setPlacesError(error instanceof Error ? error.message : 'Map places unavailable.'); })
      .finally(() => { if (active) setPlacesLoading(false); });
    return () => { active = false; };
  }, [center.latitude, center.longitude, lookupAttempt]);

  useEffect(() => {
    let active = true, busy = false;
    const refresh = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try { const data = await citizenMapApi.incidents(); if (active) {
        setIncidents(data); setIncidentError(''); setIncidentChecked(new Date().toISOString());
      } } catch (error) { if (active) setIncidentError(error instanceof Error ? error.message : 'Your SOS feed is unavailable.'); }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  useEffect(() => {
    const view = host.current?.citizenMap;
    if (ready && view) setSharedHazardsVisible(view.map, visible.hazards);
  }, [ready, visible.hazards]);

  useEffect(() => {
    const view = host.current?.citizenMap;
    if (!ready || !view) return;
    const { map, L } = view;
    if (drawn.current) map.removeLayer(drawn.current);
    const group = L.layerGroup().addTo(map); drawn.current = group;
    const marker = (lat: number, lon: number, kind: string, glyph: string, title: string, detail: string) => {
      if (!pointValid(lat, lon)) return;
      return L.marker([lat, lon], { title,
        icon: L.divIcon({ className: `citizen-geo-marker ${kind}`, html: `<span>${glyph}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
      }).addTo(group).bindPopup(popup(title, detail));
    };
    if (hasLocation) marker(center.latitude, center.longitude, 'person', '●', 'Your GPS location', `${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}`);
    if (visible.facilities) {
      const facilities = places?.facilities ?? [];
      facilities.forEach(f => marker(f.latitude, f.longitude, 'facility', '+', f.name,
        `${f.kind.replaceAll('_', ' ')} · OpenStreetMap location. Open status, shelter capacity and flood safety are unverified.`));
      if (route && !facilities.some(f => Math.abs(f.latitude - route.destination_latitude) < .0001 && Math.abs(f.longitude - route.destination_longitude) < .0001)) {
        marker(route.destination_latitude, route.destination_longitude, 'facility', '+', route.destination_name, 'Route destination. Shelter availability is unverified.');
      }
    }
    incidents.forEach(record => {
      if (visible.incidents) marker(record.latitude, record.longitude, 'sos', 'SOS', `Your ${record.emergency_type} request`, `${record.id} · ${record.status.replaceAll('_', ' ')} · Last shared citizen location`);
      if (visible.responders && pointValid(record.responder_latitude, record.responder_longitude)) {
        marker(record.responder_latitude!, record.responder_longitude!, 'responder', 'R', record.responder_name || 'Your assigned responder',
          `${record.navigation_status?.replaceAll('_', ' ') || record.status} · Last received ${record.eta_updated_at ? new Date(record.eta_updated_at).toLocaleTimeString() : 'time unavailable'}`);
      }
      const recorded = record.recommended_route?.geometry;
      if (visible.routes && geometryValid(recorded)) L.polyline(recorded, { color: '#526785', weight: 4, dashArray: '7 7' })
        .addTo(group).bindPopup(popup('Recorded responder route', `${record.id} · Last calculated route; field conditions may have changed.`));
    });
    if (visible.routes && comparisons) route?.screened_routes?.forEach(candidate => {
      if (candidate.status === 'recommended' || !geometryValid(candidate.geometry)) return;
      L.polyline(candidate.geometry, { color: candidate.status === 'rejected' ? '#bd2427' : '#7e8a97', weight: 4, dashArray: '8 7' })
        .addTo(group).bindPopup(popup(candidate.status === 'rejected' ? 'Rejected route' : 'Route alternative', candidate.rejection_reasons?.join('; ') || 'Alternative road route'));
    });
    if (visible.routes && route?.screening_status === 'complete' && route.recommended_count === 1 && geometryValid(route.geometry)) {
      L.polyline(route.geometry, { color: '#ffffff', weight: 9, opacity: .95 }).addTo(group);
      L.polyline(route.geometry, { color: guidanceActive ? '#2b8158' : '#8a742e', weight: 6 })
        .addTo(group).bindPopup(popup('Recommended evacuation route', route.warning));
    }
    // Data polling and layer toggles never change the user's viewport.
    const key = route?.recommended_count === 1 && geometryValid(route.geometry) ? JSON.stringify(route.geometry) : '';
    if (key && key !== fitted.current) { map.fitBounds(route!.geometry, { padding: [45, 45], maxZoom: 15 }); fitted.current = key; }
  }, [ready, center.latitude, center.longitude, hasLocation, places, incidents, route, visible, comparisons, guidanceActive]);

  const focusLocation = () => host.current?.citizenMap?.map.setView([center.latitude, center.longitude], hasLocation ? 15 : 12);
  const focusSOS = () => { const first = incidents[0]; if (first) host.current?.citizenMap?.map.setView([first.latitude, first.longitude], 15); };
  const unavailable = placesError || places?.facilities_status === 'unavailable';
  return <section className="citizen-map-card">
    <header className="citizen-map-card-heading"><div><span>LOCAL SAFETY VIEW</span><strong>{hasLocation ? 'Around your location' : 'Explore Houston · location not shared'}</strong></div><span className="citizen-map-feed">{incidentError || hazards.error ? 'Updates unavailable' : incidentChecked ? 'Connected' : 'Connecting…'}</span></header>
    <div className="citizen-map-toolbar" aria-label="Map layers">
      {([['hazards', 'Reported hazards'], ['incidents', 'My SOS'], ['facilities', 'Nearby facilities'], ['responders', 'My responder'], ['routes', 'Routes']] as [Layer, string][]).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={visible[key]} className={visible[key] ? 'active' : ''} onClick={() => setVisible(v => ({ ...v, [key]: !v[key] }))}>{label}</button>)}
    </div>
    <div className="citizen-map-location"><div><strong>{places?.location.primary || (hasLocation ? 'Current GPS location' : 'Houston area')}</strong><span>{places?.location.secondary || `${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}`}</span></div><button type="button" disabled={!ready} onClick={focusLocation}>{hasLocation ? 'Recenter' : 'Reset view'}</button>{incidents.length > 0 && <button type="button" disabled={!ready} onClick={focusSOS}>Find my SOS</button>}</div>
    {mapError && <div className="citizen-map-notice" role="status">{mapError} <button type="button" onClick={() => setAttempt(n => n + 1)}>Reload map</button></div>}
    <div className="citizen-map-canvas-wrap"><div ref={host} data-citizen-map className="interactive-safety-map citizen-street-map" aria-label="Citizen street map with recorded geographic layers"/></div>
    <div className="citizen-map-legend"><span><i className="hazard"/>Reported hazard</span><span><i className="sos"/>My SOS</span><span><i className="facility"/>Mapped facility</span><span><i className="responder"/>My responder</span><span><i className="route"/>Evacuation route</span></div>
    {Boolean(route?.screened_routes?.length) && <button className="citizen-compare-routes" type="button" aria-pressed={comparisons} onClick={() => setComparisons(v => !v)}>{comparisons ? 'Hide route alternatives' : 'Compare route alternatives'}</button>}
    <div className="citizen-map-source" role="status"><p>{placesLoading ? 'Loading nearby facilities…' : unavailable ? (placesError || places?.notice) : `${places?.facilities.length ?? 0} mapped facilities within 3.5 km · OpenStreetMap / Overpass`}{!placesLoading && <button type="button" onClick={() => setLookupAttempt(n => n + 1)}>Refresh places</button>}</p><p>{incidentError ? `Your incident feed is unavailable; displayed records may be outdated. ${incidentError}` : incidentChecked ? `${incidents.length} active request${incidents.length === 1 ? '' : 's'} belonging to you · checked ${new Date(incidentChecked).toLocaleTimeString()}` : 'Loading your active requests…'}</p><p>Shared hazards are unverified reports. Facilities are not confirmed open shelters. No official flood-zone layer is connected.</p></div>
  </section>;
}
