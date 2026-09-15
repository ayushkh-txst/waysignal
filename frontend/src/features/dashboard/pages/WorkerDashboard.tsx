import { useEffect, useMemo, useRef, useState } from 'react';
import { authSession } from '../../auth/auth-session';
import { citizenSafetyApi, type EmergencyListFilters, type EmergencyRecord, type EmergencyStatus } from '../api/citizen-safety.api';
import './WorkerDashboard.css';
import './WorkerMapEnhancements.css';
import './GOneAdminBrand.css';
import ResponderOperationsMap from './ResponderOperationsMap';
import OperationalReports from './OperationalReports';
import { DispatchNotifications, IncidentDispatchCard } from './DispatchAssistant';

type IconName = 'dashboard' | 'map' | 'incident' | 'queue' | 'report';
type ViewName = 'queue' | 'map' | 'dashboard' | 'reports';
type IncidentFilter = 'all' | 'new' | 'assigned' | 'en_route' | 'resolved' | 'live' | 'demo';

const incidentFilters: Array<{ key: IncidentFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'en_route', label: 'En Route' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'live', label: 'Live only' },
  { key: 'demo', label: 'Demo' },
];

function filterToApi(filter: IncidentFilter): EmergencyListFilters | undefined {
  if (filter === 'new') return { status: 'submitted' };
  if (filter === 'assigned') return { status: 'assigned' };
  if (filter === 'en_route') return { status: 'en_route' };
  if (filter === 'resolved') return { status: 'resolved' };
  if (filter === 'live') return { is_demo: false };
  if (filter === 'demo') return { is_demo: true };
  return undefined;
}

function matchesIncidentFilter(record: EmergencyRecord, filter: IncidentFilter) {
  if (record.status === 'cancelled') return false;
  if (filter === 'all') return true;
  if (filter === 'new') return record.status === 'submitted';
  if (filter === 'assigned') return record.status === 'assigned';
  if (filter === 'en_route') return record.status === 'en_route';
  if (filter === 'resolved') return record.status === 'resolved';
  if (filter === 'live') return !record.is_demo;
  return Boolean(record.is_demo);
}

function Icon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'dashboard') return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
  if (name === 'map') return <svg {...common}><path d="M3 6.5 8.5 4l7 3 5.5-2.5v13L15.5 20l-7-3L3 19.5z"/><path d="M8.5 4v13M15.5 7v13"/></svg>;
  if (name === 'incident') return <svg {...common}><path d="M12 3 3 20h18L12 3Z"/><path d="M12 9v4M12 17h.01"/></svg>;
  if (name === 'queue') return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 2.5 2.5L16 9"/></svg>;
  if (name === 'report') return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 16v-3M12 16V9M16 16v-6"/></svg>;
  return null;
}

const statusOrder: EmergencyStatus[] = ['submitted', 'assigned', 'en_route', 'resolved'];

function statusLabel(status: EmergencyStatus) {
  if (status === 'submitted') return 'NEW';
  if (status === 'assigned') return 'ASSIGNED';
  if (status === 'en_route') return 'EN ROUTE';
  return 'RESOLVED';
}

export default function WorkerDashboard() {
  const session = authSession.get();
  const [records, setRecords] = useState<EmergencyRecord[]>([]);
  const [queueRecords, setQueueRecords] = useState<EmergencyRecord[]>([]);
  const [activeFilter, setActiveFilter] = useState<IncidentFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [activeView, setActiveView] = useState<ViewName>('queue');
  const viewRef = useRef(activeView);
  viewRef.current = activeView;
  const [showDemo, setShowDemo] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const workerName = session?.user.name ?? 'Demo E-Worker';
  const workerId = session?.user.id ?? 'worker-demo';

  const loadQueue = async (filter: IncidentFilter) => {
    try {
      const allRequest = citizenSafetyApi.listEmergencies();
      const filteredRequest = filter === 'all' ? allRequest : citizenSafetyApi.listEmergencies(filterToApi(filter));
      const [allResponse, filteredResponse] = await Promise.all([allRequest, filteredRequest]);
      const allData = allResponse.filter((item) => item.status !== 'cancelled');
      const filteredData = filteredResponse.filter((item) => matchesIncidentFilter(item, filter));
      setRecords(allData);
      setQueueRecords(filteredData);
      setSelectedId((current) => {
        const selectable = viewRef.current === 'map' ? allData : filteredData;
        return current && selectable.some((item) => item.id === current) ? current : selectable[0]?.id ?? null;
      });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load emergency queue');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    setLoading(true);
    void loadQueue(activeFilter);
    const timer = window.setInterval(() => void loadQueue(activeFilter), 5000);
    return () => window.clearInterval(timer);
  }, [activeFilter]);

  const selected = useMemo(() => records.find((item) => item.id === selectedId) ?? null, [records, selectedId]);
  const pendingCount = records.filter((r) => r.status === 'submitted' && !r.is_demo).length;
  const filterCount = (filter: IncidentFilter) => records.filter((record) => matchesIncidentFilter(record, filter)).length;

  const visibleMapRecords = useMemo(() => records.filter((record) => {
    if (!showDemo && record.is_demo) return false;
    if (!showResolved && record.status === 'resolved') return false;
    return true;
  }), [records, showDemo, showResolved]);

  useEffect(() => {
    if (activeView !== 'map') return;
    if (!visibleMapRecords.some(record => record.id === selectedId)) {
      setSelectedId(visibleMapRecords.find(record => !record.is_demo)?.id ?? visibleMapRecords[0]?.id ?? null);
    }
  }, [activeView, visibleMapRecords, selectedId]);

  const updateStatus = async (status: EmergencyStatus) => {
    if (!selected) return;
    setUpdating(true);
    try {
      const updated = await citizenSafetyApi.updateEmergency(selected.id, {
        status,
        ...(status === 'assigned' ? { responder_id: workerId, responder_name: workerName } : {}),
      });
      setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
      await loadQueue(activeFilter);
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update incident'); }
    finally { setUpdating(false); }
  };

  const timeAgo = (iso: string) => {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
  };

  const mapUrl = selected ? `https://www.openstreetmap.org/export/embed.html?bbox=${selected.longitude - 0.01}%2C${selected.latitude - 0.007}%2C${selected.longitude + 0.01}%2C${selected.latitude + 0.007}&layer=mapnik&marker=${selected.latitude}%2C${selected.longitude}` : '';
  const currentStatusIndex = selected ? statusOrder.indexOf(selected.status) : -1;

  const openIncidentFromMap = (record: EmergencyRecord) => {
    setActiveFilter('all');
    setSelectedId(record.id);
    setShowMap(false);
    setActiveView('queue');
  };

  const acknowledge = async () => {
    if (!selected) return;
    setUpdating(true);
    try {
      await citizenSafetyApi.acknowledgeEmergency(selected.id);
      await loadQueue(activeFilter);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to acknowledge incident'); }
    finally { setUpdating(false); }
  };

  return (
    <main data-worker-view={activeView} className={`ops-shell ${activeView !== 'queue' ? 'map-mode' : ''}`}>
      <aside className="ops-sidebar">
        <div className="ops-logo-row gone-admin-brand" role="img" aria-label="G-One, Emergency Response"><div className="ops-logo" title="G-One"><img src={`${import.meta.env.BASE_URL}g-one-mark.svg`} alt=""/></div><div className="gone-brand-copy"><strong>G-One</strong><span>Emergency Response</span></div></div>
        <div className="ops-role">Responder</div>
        <nav className="ops-nav" aria-label="Responder navigation">
          {([
            ['dashboard', 'Dashboard', 'dashboard'], ['map', 'Live Map', 'map'],
            ['queue', 'Incident Queue', 'queue'],
            ['reports', 'Reports', 'report'],
          ] as Array<[ViewName, string, IconName]>).map(([view, label, icon]) => (
            <button key={view} type="button" data-worker-nav={view}
              className={activeView === view ? 'active' : ''}
              aria-current={activeView === view ? 'page' : undefined}
              onClick={() => setActiveView(view)}>
              <Icon name={icon}/><span>{label}</span>
              {view === 'queue' && pendingCount > 0 && <b>{pendingCount}</b>}
            </button>
          ))}
        </nav>
        <DispatchNotifications onOpenIncident={(id) => {
          const record = records.find(item => item.id === id);
          if (record) openIncidentFromMap(record);
          else void citizenSafetyApi.getEmergency(id).then(item => {
            setRecords(current => [item, ...current.filter(row => row.id !== item.id)]);
            openIncidentFromMap(item);
          }).catch(err => setError(err instanceof Error ? err.message : 'Unable to open incident'));
        }}/>
        <div className="ops-user"><span>{workerName.slice(0,1).toUpperCase()}</span><div><strong>{workerName}</strong><small>Responder</small></div><b>›</b></div>
      </aside>

      {activeView === 'queue' ? <>
        <section className="ops-queue-pane">
          <header><h2>Approve Requests</h2><strong>Awaiting Approval: {pendingCount}</strong><span>{incidentFilters.find((filter) => filter.key === activeFilter)?.label} incidents · auto-refresh 5s</span></header>
          <div className="command-center-filters incident-filter-grid" data-command-center-filters>
            {incidentFilters.map((filter) => (
              <button
                type="button"
                key={filter.key}
                data-incident-filter={filter.key}
                className={`${activeFilter === filter.key ? 'active' : ''} ${filter.key === 'demo' ? 'incident-filter-full-row' : ''}`.trim()}
                aria-pressed={activeFilter === filter.key}
                onClick={() => setActiveFilter(filter.key)}
              >
                <span>{filter.label}</span><b>{filterCount(filter.key)}</b>
              </button>
            ))}
          </div>
          <div className="ops-queue-list">
            {loading ? <div className="ops-empty">Loading emergency queue…</div> : queueRecords.length === 0 ? <div className="ops-empty">No {activeFilter === 'all' ? '' : `${incidentFilters.find((filter) => filter.key === activeFilter)?.label.toLowerCase()} `}incidents right now.</div> : queueRecords.map((record) => (
              <button key={record.id} className={selected?.id === record.id ? 'active' : ''} onClick={() => { setSelectedId(record.id); setShowMap(false); }}>
                <div className="queue-top"><span>{record.id}</span>{record.is_demo ? <em className="demo-badge">DEMO</em> : record.status === 'submitted' ? <em>LIVE · NEW</em> : <em className="live-badge">LIVE</em>}<small>{timeAgo(record.created_at)}</small></div>
                <h3>{record.citizen_name}</h3>
                <div className="queue-bottom"><span className={`type ${record.emergency_type}`}>{record.emergency_type === 'rescue' ? 'Trapped Response' : record.emergency_type === 'medical' ? 'Medical Response' : 'Evacuation Response'}</span><strong>{record.people_count} {record.people_count === 1 ? 'person' : 'people'}</strong></div>
              </button>
            ))}
          </div>
          <div className="ops-citizen-sos"><span>CITIZEN SOS</span><button type="button">I NEED HELP</button></div>
        </section>

        <section className="ops-detail-pane">
          {error && <div className="ops-error">{error}</div>}
          {!selected ? <div className="ops-detail-empty">Select an emergency request to view details.</div> : <>
            <header className="ops-detail-header">
              <div><div className="ops-id-row"><span>{selected.id}</span>{selected.is_demo && <b className="ops-demo-label">DEMO INCIDENT</b>}<em>{selected.emergency_type === 'rescue' ? 'Trapped Response' : selected.emergency_type === 'medical' ? 'Medical Response' : 'Evacuation Response'}</em></div><h1>{selected.citizen_name}</h1><p>{selected.is_demo ? 'Seeded demonstration incident' : 'Live citizen SOS'} · {selected.people_count} {selected.people_count === 1 ? 'person' : 'people'} · {timeAgo(selected.created_at)}</p></div>
              <div className="ops-header-actions">
                {!selected.acknowledged_at && !['resolved', 'cancelled'].includes(selected.status) && <button disabled={updating} onClick={() => void acknowledge()}>Acknowledge</button>}
                <button className="primary" disabled={updating || selected.status !== 'submitted'} onClick={() => void updateStatus('assigned')}>Assign Responder</button>
                <button onClick={() => setShowMap((value) => !value)}>View on Map</button>
              </div>
            </header>

            {showMap && <div className="ops-inline-map"><iframe title="Citizen emergency location" src={mapUrl} loading="lazy"/></div>}

            <div className="ops-main-grid">
              <article className="ops-card ops-timeline">
                <span className="ops-card-label">RESPONSE TIMELINE</span>
                {[
                  ['Received','Request entered queue'],['Acknowledged','Responder review'],['Assigned', selected.responder_name || 'Awaiting responder'],['En Route','Responder traveling'],['On Scene','Field response'],['Resolved','Incident closed'],
                ].map(([label, sub], index) => {
                  const stageMap = [0,0,1,2,3,3];
                  const done = index === 1 ? Boolean(selected.acknowledged_at) : index === 4 ? Boolean(selected.on_scene_at) : currentStatusIndex >= stageMap[index];
                  const current = (selected.status === 'submitted' && index === 0) || (selected.status === 'assigned' && index === 2) || (selected.status === 'en_route' && index === 3) || (selected.status === 'resolved' && index === 5);
                  return <div className={`timeline-row ${done ? 'done' : ''} ${current ? 'current' : ''}`} key={label}><i>{done ? '✓' : ''}</i><div><strong>{label}{current && <em>CURRENT</em>}</strong><span>{sub}</span></div></div>;
                })}
                <div className="timeline-actions"><button disabled={updating || selected.status !== 'assigned'} onClick={() => void updateStatus('en_route')}>Mark En Route</button><button disabled={updating || selected.status === 'resolved'} onClick={() => void updateStatus('resolved')}>Resolve Incident</button></div>
              </article>

              <div className="ops-side-stack">
                <article className="ops-card responder-card"><span className="ops-card-label">ASSIGNED RESPONDER</span>{selected.responder_name ? <div className="responder-row"><span>{selected.responder_name.slice(0,2).toUpperCase()}</span><div><strong>{selected.responder_name}</strong><small>Responder unit · assigned</small></div><em>{selected.status === 'en_route' ? '● En Route' : selected.status === 'resolved' ? '✓ Resolved' : '● Assigned'}</em></div> : <div className="unassigned">No responder assigned yet.</div>}</article>
                <IncidentDispatchCard record={selected}/>
                <article className="ops-card metric-card"><div><span>RAIN NEXT 6H</span><strong>{selected.precipitation_next_6h_mm != null ? `${selected.precipitation_next_6h_mm.toFixed(1)} mm` : '—'}</strong></div><div><span>RISK SCORE</span><strong>{selected.risk_score != null ? `${selected.risk_score} / 100` : '—'}</strong></div><div><span>GPS ACCURACY</span><strong>{selected.accuracy_m != null ? `±${Math.round(selected.accuracy_m)}m` : '—'}</strong></div><div><span>ELAPSED</span><strong>{timeAgo(selected.created_at).replace(' ago','')}</strong></div><div><span>RIVER DISCHARGE</span><strong>{selected.river_discharge_m3s != null ? `${selected.river_discharge_m3s.toFixed(1)} m³/s` : '—'}</strong></div><div><span>LOCATION</span><strong>{selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)}</strong></div></article>
              </div>
            </div>
          </>}
        </section>
      </> : activeView === 'map' ? <section className="ops-map-page">
        <header className="ops-map-header">
          <div><span className="ops-card-label">LIVE OPERATIONS MAP</span><h1>Active emergency response</h1><p>Geographic SOS positions and shared user-reported hazards. Reports are unverified; no official flood-zone or shelter-status feed is connected.</p></div>
          <div className="ops-map-live">● LIVE · AUTO-REFRESH 5s</div>
        </header>

        <div className="ops-map-stats">
          <div><span>ACTIVE INCIDENTS</span><strong>{records.filter((r) => r.status !== 'resolved').length}</strong></div>
          <div><span>LIVE SOS</span><strong>{records.filter((r) => !r.is_demo && r.status !== 'resolved').length}</strong></div>
          <div><span>UNASSIGNED</span><strong>{records.filter((r) => r.status === 'submitted').length}</strong></div>
          <div><span>EN ROUTE</span><strong>{records.filter((r) => r.status === 'en_route').length}</strong></div>
        </div>

        <div className="ops-map-toolbar">
          <button className={showDemo ? 'active' : ''} onClick={() => setShowDemo((v) => !v)}>DEMO incidents</button>
          <button className={showResolved ? 'active' : ''} onClick={() => setShowResolved((v) => !v)}>Resolved</button>
          <span><i className="legend-dot live"/> Live SOS</span><span><i className="legend-dot demo"/> Demo</span><span><i className="legend-dot assigned"/> Assigned</span><span><i className="legend-dot route"/> En route</span>
        </div>

        <div className="ops-map-layout">
          <ResponderOperationsMap records={visibleMapRecords} selectedId={selectedId} onSelect={setSelectedId}/>

          <aside className="ops-map-side">
            {selected ? <>
              <div className="ops-map-selected-head"><div><span>{selected.id}</span>{selected.is_demo ? <em>DEMO</em> : <em className="live">LIVE</em>}</div><h2>{selected.citizen_name}</h2><p>{selected.emergency_type.toUpperCase()} · {selected.people_count} {selected.people_count === 1 ? 'person' : 'people'}</p></div>
              <div className={`ops-map-status ${selected.status}`}>{statusLabel(selected.status)}</div>
              <div className="ops-map-detail-grid"><div><span>RISK</span><strong>{selected.risk_score ?? '—'}/100</strong></div><div><span>RAIN 6H</span><strong>{selected.precipitation_next_6h_mm != null ? `${selected.precipitation_next_6h_mm.toFixed(1)} mm` : '—'}</strong></div><div><span>GPS</span><strong>{selected.accuracy_m != null ? `±${Math.round(selected.accuracy_m)}m` : '—'}</strong></div><div><span>AGE</span><strong>{timeAgo(selected.created_at)}</strong></div></div>
              {selected.responder_name ? <div className="ops-map-responder"><span>{selected.responder_name.slice(0,2).toUpperCase()}</span><div><small>ASSIGNED RESPONDER</small><strong>{selected.responder_name}</strong></div></div> : <div className="ops-map-unassigned">No responder assigned.</div>}
              {selected.notes && <div className="ops-map-note"><span>CITIZEN NOTE</span><p>{selected.notes}</p></div>}
              <div className="ops-map-actions"><button className="primary" onClick={() => openIncidentFromMap(selected)}>Open Incident</button>{selected.status === 'submitted' && <button disabled={updating} onClick={() => void updateStatus('assigned')}>Assign to me</button>}</div>
            </> : <div className="ops-map-empty">Select an SOS marker to inspect the incident.</div>}
          </aside>
        </div>
      </section> : activeView === 'reports' ? <OperationalReports onOpenIncident={id => { setActiveFilter('all'); setSelectedId(id); setShowMap(false); setActiveView('queue'); }}/>
        : <section key={activeView} className="command-center-static-view admin-dashboard-stable-host" data-worker-static-view={activeView}/>}
    </main>
  );
}
