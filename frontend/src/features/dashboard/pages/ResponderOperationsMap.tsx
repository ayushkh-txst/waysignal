import { useEffect, useRef, useState } from 'react';
import { loadLeaflet } from '../../../lib/load-leaflet';
import type { EmergencyRecord } from '../api/citizen-safety.api';
import { hazardsApi } from '../api/hazards.api';
import { attachSharedHazards } from '../user-hazard-map-enhancer';

export type ResponderMapElement = HTMLDivElement & { responderMap?: { map: any; L: any; routeLayer?: any; routeKey?: string } };

const validPoint = (p: { latitude: number; longitude: number }) =>
  Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;

/** Incident coordinates stay attached to the same geographic map as hazard markers. */
export default function ResponderOperationsMap({ records, selectedId, onSelect }: {
  records: EmergencyRecord[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const container = useRef<ResponderMapElement | null>(null);
  const current = useRef({ records, selectedId, onSelect });
  current.current = { records, selectedId, onSelect };
  const incidents = useRef(new Map<string, { marker: any; key: string }>());
  const lastFocused = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [hazards, setHazards] = useState(hazardsApi.snapshot());

  useEffect(() => hazardsApi.subscribe(setHazards), []);

  useEffect(() => {
    let disposed = false;
    let map: any;
    let resize: ResizeObserver | undefined;
    setError(''); setReady(false); lastFocused.current = null;
    loadLeaflet().then(L => {
      if (disposed || !container.current) return;
      const host = container.current;
      const list = current.current.records.filter(validPoint);
      const selected = list.find(r => r.id === current.current.selectedId);
      const first = selected ?? list.find(r => !r.is_demo) ?? list[0] ?? hazardsApi.snapshot().reports.find(validPoint);
      // A view can unmount during a zoom. Avoid Leaflet's deferred CSS zoom callback
      // touching removed map panes after rapid sidebar navigation.
      map = L.map(host, { zoomControl: true, attributionControl: true, scrollWheelZoom: true, zoomAnimation: false, markerZoomAnimation: false })
        .setView(first ? [first.latitude, first.longitude] : [29.7179, -95.4020], first ? 14 : 11);
      host.responderMap = { map, L };
      attachSharedHazards(map, L);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Source: Esri and contributors',
      }).on('tileerror', () => { if (!disposed) setError('Some map tiles could not load. Markers are still available; check your connection.'); }).addTo(map);
      if (typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver(() => map.invalidateSize());
        resize.observe(host);
      }
      setReady(true);
      window.dispatchEvent(new CustomEvent('jalrakshak:responder-map-ready'));
    }).catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'Map could not load.'); });
    return () => {
      disposed = true; resize?.disconnect();
      const host = container.current;
      if (host && host.responderMap?.map === map) delete host.responderMap;
      incidents.current.clear();
      map?.remove();
    };
  }, [attempt]);

  useEffect(() => {
    const view = container.current?.responderMap;
    if (!ready || !view) return;
    const { map, L } = view;
    const list = records.filter(validPoint);
    const ids = new Set(list.map(r => r.id));
    incidents.current.forEach((entry, id) => {
      if (!ids.has(id)) { map.removeLayer(entry.marker); incidents.current.delete(id); }
    });
    list.forEach(record => {
      const key = JSON.stringify([record.latitude, record.longitude, record.status, record.is_demo, record.citizen_name, record.people_count, selectedId === record.id]);
      const previous = incidents.current.get(record.id);
      if (previous?.key === key) return;
      if (previous) map.removeLayer(previous.marker);
      const icon = L.divIcon({
        className: 'ops-geographic-incident',
        html: `<span class="${record.is_demo ? 'demo' : record.status} ${selectedId === record.id ? 'selected' : ''}">SOS</span>`,
        iconSize: [38, 38], iconAnchor: [19, 19],
      });
      const popup = document.createElement('div');
      popup.className = 'ops-geographic-popup';
      const title = document.createElement('strong'); title.textContent = record.citizen_name;
      const detail = document.createElement('p');
      detail.textContent = `${record.is_demo ? 'DEMO' : 'LIVE SOS'} · ${record.id} · ${record.status.replace('_', ' ')} · ${record.people_count} people`;
      const inspect = document.createElement('button'); inspect.type = 'button'; inspect.textContent = 'Select incident';
      inspect.onclick = () => current.current.onSelect(record.id);
      popup.append(title, detail, inspect);
      const marker = L.marker([record.latitude, record.longitude], { icon, zIndexOffset: -100, title: `${record.citizen_name} SOS` })
        .addTo(map).bindPopup(popup);
      incidents.current.set(record.id, { marker, key });
    });
    const selected = list.find(r => r.id === selectedId);
    // Selecting an SOS focuses it. Polling and optional demo overlays do not reset zoom/pan.
    if (selected && lastFocused.current !== selected.id) {
      map.setView([selected.latitude, selected.longitude], 14);
      lastFocused.current = selected.id;
    }
  }, [ready, records, selectedId]);

  const focusHazards = () => {
    const view = container.current?.responderMap;
    const points = hazards.reports.filter(validPoint).map(r => [r.latitude, r.longitude]);
    if (view && points.length) view.map.fitBounds(points, { padding: [50, 50], maxZoom: 16 });
  };
  const focusIncident = () => {
    const selected = records.find(r => r.id === selectedId);
    if (selected && validPoint(selected)) container.current?.responderMap?.map.setView([selected.latitude, selected.longitude], 15);
  };

  return <div className="ops-map-surface">
    <div className="ops-map-focus-controls">
      <button type="button" onClick={focusIncident} disabled={!ready || !selectedId}>Focus selected SOS</button>
      <button type="button" onClick={focusHazards} disabled={!ready || !hazards.reports.length}>Show reported hazards ({hazards.reports.length})</button>
      <span>“SOS” = incident · red symbol = unverified hazard</span>
    </div>
    {error && <div className="ops-map-error" role="status">{error} {!ready && <button type="button" onClick={() => setAttempt(n => n + 1)}>Retry map</button>}</div>}
    <div className="ops-operations-map">
      <div ref={container} data-responder-map className="ops-leaflet-map" aria-label="Responder incident and shared hazard map"/>
    </div>
    <p className="ops-map-data-note">Demo incidents are hidden by default. Reported hazards are unverified; no official flood polygons or confirmed shelters are shown.</p>
  </div>;
}
