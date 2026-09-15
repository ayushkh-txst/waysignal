import { useEffect, useMemo, useRef, useState } from 'react';
import { citizenSafetyApi, type EmergencyRecord, type EmergencyType, type SafetyContext } from '../api/citizen-safety.api';
import './CitizenEmergencyHelp.css';

type Props = {
  citizenId: string;
  citizenName: string;
  fallbackLatitude: number;
  fallbackLongitude: number;
  hasLocation?: boolean;
  onBack: () => void;
};

type PositionState = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  label: string;
};

const TRACKING_STEPS = [
  { key: 'submitted', title: 'Request received', detail: 'Your SOS is in the responder queue.' },
  { key: 'assigned', title: 'Responder assigned', detail: 'A response unit has accepted your request.' },
  { key: 'en_route', title: 'Help is on the way', detail: 'Your responder is traveling to your location.' },
  { key: 'resolved', title: 'Response complete', detail: 'The responder marked this incident resolved.' },
] as const;

export default function CitizenEmergencyHelp({ citizenId, citizenName, fallbackLatitude, fallbackLongitude, hasLocation = false, onBack }: Props) {
  const [position, setPosition] = useState<PositionState>({ latitude: fallbackLatitude, longitude: fallbackLongitude, accuracy: null, label: hasLocation ? 'Last selected GPS location' : 'Location not shared' });
  const [locationConfirmed, setLocationConfirmed] = useState(hasLocation);
  const [safety, setSafety] = useState<SafetyContext | null>(null);
  const [safetyError, setSafetyError] = useState('');
  const [type, setType] = useState<EmergencyType>('rescue');
  const [peopleCount, setPeopleCount] = useState(1);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [record, setRecord] = useState<EmergencyRecord | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [trackingError, setTrackingError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [gpsLive, setGpsLive] = useState(false);
  const [gpsMessage, setGpsMessage] = useState('GPS will update responders while this SOS is active.');
  const lastLocationSentAt = useRef(0);
  const locationUpdateInFlight = useRef(false);

  const refreshSafety = async (latitude: number, longitude: number) => {
    setSafetyError('');
    try { setSafety(await citizenSafetyApi.getContext(latitude, longitude)); }
    catch (error) { setSafetyError(error instanceof Error ? error.message : 'Live environmental data unavailable'); }
  };

  useEffect(() => { if (hasLocation) void refreshSafety(position.latitude, position.longitude); }, []);

  useEffect(() => {
    if (!record || record.status === 'resolved' || record.status === 'cancelled') return;
    let active = true;
    const refresh = async () => {
      try {
        const latest = await citizenSafetyApi.getEmergency(record.id);
        if (active) {
          setRecord(latest);
          setTrackingError('');
        }
      } catch (error) {
        if (active) setTrackingError(error instanceof Error ? error.message : 'Unable to refresh responder status');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [record?.id, record?.status]);

  useEffect(() => {
    if (!record || record.status === 'resolved' || record.status === 'cancelled') {
      setGpsLive(false);
      return;
    }
    if (!navigator.geolocation) {
      setGpsMessage('Live GPS is not supported by this browser. Responders will use the last known location.');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (result) => {
        const next = {
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
          accuracy: result.coords.accuracy,
          label: 'Live GPS location',
        };
        setPosition(next);
        setGpsLive(true);
        setGpsMessage(`Live GPS · accuracy ±${Math.round(result.coords.accuracy)} m`);

        const now = Date.now();
        if (now - lastLocationSentAt.current < 4000 || locationUpdateInFlight.current) return;
        lastLocationSentAt.current = now;
        locationUpdateInFlight.current = true;
        void citizenSafetyApi.updateEmergencyLocation(record.id, {
          latitude: next.latitude,
          longitude: next.longitude,
          accuracy_m: next.accuracy,
        }).then((latest) => {
          setRecord(latest);
          setTrackingError('');
        }).catch((error) => {
          setTrackingError(error instanceof Error ? error.message : 'Unable to share your latest GPS location');
        }).finally(() => {
          locationUpdateInFlight.current = false;
        });
      },
      (error) => {
        setGpsLive(false);
        setGpsMessage(error.code === error.PERMISSION_DENIED
          ? 'Location permission is off. Responders are using your last known location.'
          : 'GPS signal unavailable. Responders are using your last known location.');
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [record?.id, record?.status]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setPosition((current) => ({ ...current, label: 'Locating…' }));
    navigator.geolocation.getCurrentPosition(
      (result) => {
        const next = { latitude: result.coords.latitude, longitude: result.coords.longitude, accuracy: result.coords.accuracy, label: 'Current GPS location' };
        setPosition(next); setLocationConfirmed(true); void refreshSafety(next.latitude, next.longitude);
      },
      () => setPosition((current) => ({ ...current, label: 'Location permission not granted' })),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const submitEmergency = async () => {
    if (!locationConfirmed) { setSubmitError('Use your current location before sending this request.'); return; }
    setSubmitting(true); setSubmitError('');
    try {
      setRecord(await citizenSafetyApi.createEmergency({
        citizen_id: citizenId, citizen_name: citizenName, emergency_type: type,
        latitude: position.latitude, longitude: position.longitude, accuracy_m: position.accuracy,
        people_count: peopleCount, notes: notes.trim(), risk_score: safety?.prototype_risk_score ?? null,
        risk_level: safety?.prototype_risk_level ?? null, precipitation_next_6h_mm: safety?.precipitation_next_6h_mm ?? null,
        river_discharge_m3s: safety?.river_discharge_m3s ?? null,
      }));
    } catch (error) { setSubmitError(error instanceof Error ? error.message : 'Unable to send emergency request'); }
    finally { setSubmitting(false); }
  };

  const cancelRequest = async () => {
    if (!record || record.status !== 'submitted') return;
    setCancelling(true); setTrackingError('');
    try { setRecord(await citizenSafetyApi.cancelEmergency(record.id)); }
    catch (error) { setTrackingError(error instanceof Error ? error.message : 'Unable to cancel request'); }
    finally { setCancelling(false); }
  };

  const currentStepIndex = useMemo(() => {
    if (!record) return -1;
    if (record.status === 'assigned') return 1;
    if (record.status === 'en_route') return 2;
    if (record.status === 'resolved') return 3;
    return 0;
  }, [record]);

  const formatEta = (seconds?: number | null) => {
    if (seconds == null || !Number.isFinite(seconds)) return null;
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
  };

  const formatResponderDistance = (meters?: number | null) => {
    if (meters == null || !Number.isFinite(meters)) return null;
    return meters >= 1609.344 ? `${(meters / 1609.344).toFixed(1)} mi` : `${Math.max(1, Math.round(meters * 3.28084))} ft`;
  };

  const formatUpdatedTime = (iso?: string | null) => {
    if (!iso) return null;
    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  };

  if (record) {
    const cancelled = record.status === 'cancelled';
    const navigationStatus = record.navigation_status ?? (record.status === 'cancelled' ? null : record.status);
    const etaLabel = formatEta(record.responder_eta_seconds);
    const distanceLabel = formatResponderDistance(record.responder_distance_m);
    const etaUpdatedLabel = formatUpdatedTime(record.eta_updated_at ?? record.route_updated_at);
    const synchronizedLabel = formatUpdatedTime(record.updated_at ?? record.created_at);
    const headline = cancelled ? 'Request cancelled' : navigationStatus === 'approaching' ? 'Responder is approaching' : navigationStatus === 'on_scene' ? 'Responder is on scene' : record.status === 'submitted' ? 'Waiting for a responder' : record.status === 'assigned' ? 'Responder assigned' : record.status === 'en_route' ? 'Help is on the way' : 'Response complete';
    const copy = cancelled ? 'This emergency request has been closed. You can return to the overview and create a new request if needed.' : navigationStatus === 'approaching' ? `${record.responder_name ?? 'Your responder'} is close to your location. Keep your phone available.` : navigationStatus === 'on_scene' ? `${record.responder_name ?? 'Your responder'} has arrived at your location.` : record.status === 'submitted' ? 'Your SOS is active and visible in the responder queue. This page checks for updates every 3 seconds.' : record.status === 'assigned' ? `${record.responder_name ?? 'A responder'} has accepted your request and is preparing to respond.` : record.status === 'en_route' ? `${record.responder_name ?? 'Your responder'} is en route to your location. Keep your phone available.` : 'The responder marked this incident resolved.';

    return (
      <section className="emergency-screen rescue-tracking-screen">
        <div className={`tracking-hero ${record.status}`}>
          <div className="tracking-live-dot" />
          <span className="safe-eyebrow">LIVE RESCUE TRACKING</span>
          <h1>{headline}</h1>
          <p>{copy}</p>
          <div className="tracking-request-meta">
            <span><b>Request ID</b><strong>{record.id}</strong></span>
            <span><b>Status</b><strong>{record.status.replace('_', ' ').toUpperCase()}</strong></span>
            <span><b>Emergency</b><strong>{record.emergency_type.toUpperCase()}</strong></span>
          </div>
        </div>

        {!cancelled && (
          <div className="tracking-grid">
            <article className="tracking-card">
              <span className="emergency-label">RESPONSE STATUS</span>
              <div className="tracking-timeline">
                {TRACKING_STEPS.map((step, index) => {
                  const done = index <= currentStepIndex;
                  const current = index === currentStepIndex && record.status !== 'resolved';
                  return (
                    <div key={step.key} className={`tracking-step ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                      <i>{done ? '✓' : ''}</i>
                      <div><strong>{step.title}{current && <em>LIVE</em>}</strong><span>{step.detail}</span></div>
                    </div>
                  );
                })}
              </div>
            </article>

            <aside className="tracking-card responder-tracking-card">
              <span className="emergency-label">RESPONDER</span>
              {record.responder_name ? (
                <div className="citizen-responder-row">
                  <div>{record.responder_name.slice(0, 2).toUpperCase()}</div>
                  <span><strong>{record.responder_name}</strong><small>{record.status === 'en_route' ? 'Responder en route' : record.status === 'resolved' ? 'Response completed' : 'Assigned to your request'}</small></span>
                </div>
              ) : (
                <div className="awaiting-responder"><div className="tracking-spinner"/><strong>Finding an available responder</strong><span>Your request is visible in the emergency queue.</span></div>
              )}
              {record.responder_name && (
                <div className="citizen-response-progress">
                  <div>
                    <span>RESPONDER STATUS</span>
                    <strong>{navigationStatus?.replace('_', ' ').toUpperCase() ?? 'ASSIGNED'}</strong>
                  </div>
                  <div>
                    <span>ETA</span>
                    <strong>{etaLabel ?? (record.status === 'assigned' ? 'Preparing route' : record.status === 'resolved' ? 'Complete' : 'Waiting for route')}</strong>
                  </div>
                  <div>
                    <span>DISTANCE</span>
                    <strong>{distanceLabel ?? '—'}</strong>
                  </div>
                  <small>{etaUpdatedLabel ? `ETA updated at ${etaUpdatedLabel}` : 'ETA will appear when the responder route is saved to the emergency record.'}</small>
                </div>
              )}
              <div className="tracking-location">
                <span>YOUR LOCATION</span>
                <strong>{record.latitude.toFixed(5)}, {record.longitude.toFixed(5)}</strong>
                {record.accuracy_m != null && <small>GPS accuracy ±{Math.round(record.accuracy_m)} m</small>}
                {record.status !== 'resolved' && <small>{gpsLive ? '● ' : '○ '}{gpsMessage}</small>}
                {synchronizedLabel && <small>Emergency record synchronized at {synchronizedLabel}</small>}
              </div>
            </aside>
          </div>
        )}

        {trackingError && <div className="emergency-error">{trackingError}</div>}
        <div className="tracking-actions">
          {record.status === 'submitted' && <button type="button" className="tracking-cancel" onClick={cancelRequest} disabled={cancelling}>{cancelling ? 'CANCELLING…' : 'CANCEL REQUEST'}</button>}
          <button type="button" className="figma-secondary" onClick={onBack}>Back to overview</button>
        </div>
      </section>
    );
  }

  return (
    <section className="emergency-screen">
      <button type="button" className="emergency-siren-cta" onClick={() => setFormOpen(true)} aria-expanded={formOpen}>
        <span className="emergency-siren-icon" aria-hidden="true">✦</span><strong>I NEED HELP</strong><span>Tap to request emergency assistance</span>
      </button>
      <div className="emergency-heading"><div><span className="safe-eyebrow">EMERGENCY HELP</span><h1>Request immediate assistance</h1><p>Your GPS location and the latest environmental snapshot will be attached to the request.</p></div><button type="button" className="location-button" onClick={useMyLocation}>⌖ Use my location</button></div>
      <div className="emergency-status-summary"><span><b>Location</b><strong>{position.label}</strong>{position.accuracy !== null && <small>±{Math.round(position.accuracy)} m accuracy</small>}</span><span><b>Flood Risk</b><strong className={safety?.prototype_risk_level === 'critical' ? 'risk-critical' : ''}>{safety ? `${safety.prototype_risk_score}/100 · ${safety.prototype_risk_level.toUpperCase()}` : 'Checking…'}</strong></span><span><b>Evacuation destination</b><strong>Check the Live Map</strong><small>Facility availability is unverified</small></span></div>
      <div className={`emergency-grid ${formOpen ? 'form-open' : ''}`}>
        <div className="emergency-form-card">
          <span className="emergency-label">WHAT HELP DO YOU NEED?</span>
          <div className="emergency-type-grid">{(['rescue','medical','evacuation'] as EmergencyType[]).map((item) => <button key={item} type="button" className={type===item?'active':''} onClick={()=>setType(item)}><strong>{item==='rescue'?'Rescue':item==='medical'?'Medical':'Evacuation'}</strong><span>{item==='rescue'?'Trapped or unable to move':item==='medical'?'Urgent medical assistance':'Need transport to safety'}</span></button>)}</div>
          <label className="emergency-field"><span>NUMBER OF PEOPLE</span><input type="number" min={1} max={50} value={peopleCount} onChange={(e)=>setPeopleCount(Math.max(1,Math.min(50,Number(e.target.value)||1)))} /></label>
          <label className="emergency-field"><span>NOTES FOR RESPONDERS</span><textarea value={notes} maxLength={500} onChange={(e)=>setNotes(e.target.value)} placeholder="Example: elderly person with us, water rising near the ground floor…"/><small>{notes.length}/500</small></label>
          {submitError && <div className="emergency-error">{submitError}</div>}
          <button type="button" className="emergency-submit" onClick={submitEmergency} disabled={submitting || !locationConfirmed}>{submitting?'SENDING REQUEST…':'SEND EMERGENCY REQUEST'}</button>
          <button type="button" className="figma-secondary emergency-back" onClick={onBack}>Cancel</button>
        </div>
        <aside className="emergency-context-card">
          <span className="emergency-label">ATTACHED LIVE CONTEXT</span>
          <div className="emergency-location-box"><strong>{position.label}</strong><span>{locationConfirmed ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}` : "Use current location to attach coordinates to your SOS."}</span>{position.accuracy!==null&&<small>GPS accuracy ±{Math.round(position.accuracy)} m</small>}</div>
          {safety ? <><div className={`emergency-risk-level ${safety.prototype_risk_level}`}><span>PROTOTYPE FLOOD RISK</span><strong>{safety.prototype_risk_score}/100 · {safety.prototype_risk_level.toUpperCase()}</strong></div><div className="emergency-live-stats"><div><span>Rain next 6h</span><strong>{safety.precipitation_next_6h_mm.toFixed(1)} mm</strong></div><div><span>Rain probability</span><strong>{safety.precipitation_probability_max_6h ?? '—'}%</strong></div><div><span>River discharge</span><strong>{safety.river_discharge_m3s!==null?`${safety.river_discharge_m3s.toFixed(1)} m³/s`:'—'}</strong></div><div><span>River trend</span><strong>{safety.river_trend_percent!==null?`${safety.river_trend_percent>0?'+':''}${safety.river_trend_percent}%`:'—'}</strong></div></div><p className="emergency-source">Live source: {safety.source}. The displayed risk score is our hackathon prototype heuristic, not an official warning.</p></> : <div className="emergency-live-loading">{safetyError||'Loading live rainfall and river data…'}</div>}
        </aside>
      </div>
    </section>
  );
}
