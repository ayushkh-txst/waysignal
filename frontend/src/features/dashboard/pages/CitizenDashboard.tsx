import { useEffect, useMemo, useRef, useState } from 'react';
import CitizenSafetyMap from './CitizenSafetyMap';
import CitizenRouteAnalysis from './CitizenRouteAnalysis';
import { authSession } from '../../auth/auth-session';
import { citizenSafetyApi, type EvacuationRoute } from '../api/citizen-safety.api';
import CitizenEmergencyHelp from './CitizenEmergencyHelp';
import './CitizenDashboard.css';
import './CitizenLiveMap.css';

type NavItem = 'Overview' | 'Live Map' | 'Alerts' | 'AI Assistant' | 'Emergency Help';
type BrowserLocation = { latitude: number; longitude: number } | null;
type GuidanceStep = { title: string; detail: string; distance: string; eta: string };
type RouteFreshness = 'live' | 'cached' | 'unavailable';
type PlaceLabel = { primary: string; secondary: string };

const navItems: Array<{ label: NavItem; icon: string; badge?: number; muted?: boolean }> = [
  { label: 'Overview', icon: '▦' },
  { label: 'Live Map', icon: '◫' },
  { label: 'Alerts', icon: '♢', badge: 2 },
  { label: 'AI Assistant', icon: '▤' },
  { label: 'Emergency Help', icon: '⊙' },
];

const INITIAL_MAP_CENTER = { latitude: 29.7604, longitude: -95.3698 };

const formatDistance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.max(1, Math.round(meters))} m`;
const formatDuration = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`;
export default function CitizenDashboard() {
  const session = authSession.get();
  const [activeNav, setActiveNav] = useState<NavItem>('Overview');
  const [showCriticalAlert, setShowCriticalAlert] = useState(true);
  const [browserLocation, setBrowserLocation] = useState<BrowserLocation>(null);
  const [locationStatus, setLocationStatus] = useState('Location not shared · exploring Houston');
  const [placeLabel, setPlaceLabel] = useState<PlaceLabel>({ primary: 'Houston area', secondary: 'Map preview · location not shared' });
  const [guidanceActive, setGuidanceActive] = useState(false);
  const [guidanceStep, setGuidanceStep] = useState(0);
  const [routeData, setRouteData] = useState<EvacuationRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [routeFreshness, setRouteFreshness] = useState<RouteFreshness>('unavailable');
  const [showRouteReasons, setShowRouteReasons] = useState(false);

  const displayName = useMemo(() => {
    const name = session?.user.name?.trim();
    return name && name !== 'Demo Citizen' ? name : 'Ramesh K.';
  }, [session?.user.name]);
  const initials = displayName.split(' ').map(part => part[0]).join('').slice(0,1).toUpperCase();
  const mapCenter = browserLocation ?? INITIAL_MAP_CENTER;
  const routeRequest = useRef(0);
  const locationRequest = useRef(0);

  const dynamicSteps: GuidanceStep[] = routeData?.steps?.length
    ? routeData.steps.map((step, index) => ({
        title: step.instruction,
        detail: index === routeData.steps.length - 1 ? `Continue toward ${routeData.destination_name}.` : 'Follow the highlighted road route.',
        distance: formatDistance(step.distance_m),
        eta: formatDuration(step.duration_s),
      }))
    : [];
  const routeIsRecommended = routeData?.screening_status === 'complete' && routeData.recommended_count === 1;
  const currentGuidance = dynamicSteps[Math.min(guidanceStep, dynamicSteps.length - 1)];
  const guidanceComplete = guidanceActive && guidanceStep === dynamicSteps.length - 1;
  const guidanceProgress = guidanceActive ? ((guidanceStep + 1) / dynamicSteps.length) * 100 : 0;

  const loadRoute = async (latitude: number, longitude: number) => {
    const request = ++routeRequest.current;
    setRouteLoading(true); setRouteError(''); setRouteData(null); setGuidanceActive(false);
    try {
      const route = await citizenSafetyApi.getEvacuationRoute(latitude, longitude);
      if (request !== routeRequest.current) return;
      setRouteData(route); setRouteFreshness('live');
      setRouteError(route.recommended_count === 0 ? route.warning : '');
    } catch (error) {
      if (request !== routeRequest.current) return;
      setRouteData(null); setRouteFreshness('unavailable');
      setRouteError(error instanceof Error ? error.message : 'Unable to calculate a route.');
    } finally { if (request === routeRequest.current) setRouteLoading(false); }
  };

  useEffect(() => () => { routeRequest.current++; locationRequest.current++; }, []);

  useEffect(() => {
    if (activeNav === 'Live Map' && browserLocation) void loadRoute(browserLocation.latitude, browserLocation.longitude);
  }, [activeNav]);

  const signOut = () => { authSession.clear(); window.history.replaceState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); };
  const requestHelp = () => { setGuidanceActive(false); setShowCriticalAlert(false); setActiveNav('Emergency Help'); };
  const openGuide = () => { setShowCriticalAlert(false); setActiveNav('Live Map'); };
  useEffect(() => {
    const invalidate = () => {
      setRouteData(null);
      setGuidanceActive(false);
      setRouteError('Shared hazard reports changed. Use your location to check a fresh route.');
    };
    window.addEventListener('jalrakshak:shared-hazards-changed', invalidate);
    return () => window.removeEventListener('jalrakshak:shared-hazards-changed', invalidate);
  }, []);

  const startGuidance = () => {
    if (routeData?.screening_status !== 'complete' || routeData.recommended_count !== 1) return;
    setGuidanceStep(0); setGuidanceActive(true); setShowCriticalAlert(false);
  };
  const stopGuidance = () => { setGuidanceActive(false); setGuidanceStep(0); };
  const advanceGuidance = () => setGuidanceStep(step => Math.min(step + 1, dynamicSteps.length - 1));
  const retryRoute = () => { if (browserLocation) void loadRoute(browserLocation.latitude, browserLocation.longitude); };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocationStatus('Location unavailable'); return; }
    const request = ++locationRequest.current;
    setLocationStatus('Locating…');
    navigator.geolocation.getCurrentPosition((position) => {
      if (request !== locationRequest.current) return;
      routeRequest.current++;
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setBrowserLocation(next);
      setLocationStatus(`Current GPS · ±${Math.round(position.coords.accuracy)} m`);
      if (!browserLocation || browserLocation.latitude !== next.latitude || browserLocation.longitude !== next.longitude) {
        setPlaceLabel({ primary: 'Current GPS location', secondary: `${next.latitude.toFixed(5)}, ${next.longitude.toFixed(5)}` });
      }
      setRouteData(null); setGuidanceActive(false);
      void loadRoute(next.latitude, next.longitude);
    }, () => { if (request === locationRequest.current) setLocationStatus('Location permission unavailable · map remains explorable'); }, { enableHighAccuracy:true, timeout:8000 });
  };

  const renderOverview = () => <>
    <div className="figma-confidence-strip"><span className="confidence-dot"/><strong>HIGH CONFIDENCE</strong><span>+9m</span><span>·</span><span>12 sec ago</span></div>
    <section className="figma-risk-card"><div className="figma-risk-header"><div><span className="risk-header-dot"/> CRITICAL · FLOOD RISK</div><span>Risk increasing rapidly</span></div><div className="figma-risk-body"><div className="warning-window"><span>ESTIMATED WARNING WINDOW</span><strong>~58 min</strong><p>Act before this window closes</p></div><div className="risk-score-ring"><div><strong>87</strong><span>/ 100</span></div></div><div className="risk-score-label">FLOOD RISK</div></div><div className="risk-divider"/><div className="factor-section"><span className="factor-title">CONTRIBUTING FACTORS</span><div className="factor-row"><span>🌧️</span><strong>Heavy forecast rainfall</strong><em>+48mm in 6 hrs</em></div><div className="factor-row"><span>🌊</span><strong>Rising river level</strong><em>Bagmati +1.2m since 06:00</em></div><div className="factor-row"><span>🚧</span><strong>Road access degrading</strong><em>2 routes blocked</em></div></div></section>
    <section className="figma-safe-card"><div className="safe-card-top"><div><span className="safe-eyebrow">RECOMMENDED SAFE DESTINATION</span><h2>{routeData?.destination_name ?? 'Shree Secondary School'}</h2><p>{routeData ? `◷ ${formatDuration(routeData.duration_s)}   ${formatDistance(routeData.distance_m)}` : '◷ 13 min   920 m   Capacity 61%'}</p></div><span className="low-risk-pill">LOW RISK</span></div><div className="safe-capacity-track"><span/></div><div className="safe-actions"><button type="button" className="figma-primary" onClick={openGuide}>GUIDE ME</button><button type="button" className="figma-secondary" onClick={() => setShowRouteReasons(v => !v)}>WHY THIS?</button></div></section>
    <section className="figma-quick-card"><span className="quick-title">QUICK ACTIONS</span><div><button type="button" onClick={() => setActiveNav('Live Map')}>🗺️ <span>View Safety Map</span></button><button type="button">🏫 <span>All Destinations</span></button></div></section>
  </>;

  const renderLiveMap = () => <section className={`live-map-screen ${guidanceActive ? 'guidance-active' : ''}`}>
    <div className="map-page-heading"><div><span className="safe-eyebrow">LIVE SAFETY MAP</span><h1>{guidanceActive ? 'Evacuation guidance' : 'Safest route around you'}</h1><p>{browserLocation ? `You are near ${placeLabel.primary}. Street and neighborhood names stay visible while JalRakshak calculates the route.` : 'Use your location to calculate a nearby real-road evacuation route.'}</p></div><button type="button" className="location-button" onClick={useMyLocation}>⌖ Use my location</button></div>
    {guidanceActive && currentGuidance && <section className={`guidance-banner ${guidanceComplete ? 'complete' : ''}`}><div className="guidance-banner-icon">{guidanceComplete ? '✓' : '➜'}</div><div className="guidance-banner-copy"><span>{guidanceComplete ? 'DESTINATION REACHED' : `STEP ${guidanceStep + 1} OF ${dynamicSteps.length}`}</span><strong>{currentGuidance.title}</strong><p>{currentGuidance.detail}</p></div><div className="guidance-banner-metrics"><strong>{currentGuidance.distance}</strong><span>{currentGuidance.eta}</span></div><div className="guidance-progress"><span style={{width:`${guidanceProgress}%`}}/></div></section>}
    <div className="map-status-row"><span><i className="status-dot green"/> {locationStatus}</span>{browserLocation && <span className="place-status-pill"><i className="status-dot blue"/> {placeLabel.primary}</span>}<span><i className={`status-dot ${routeFreshness === 'live' ? 'green' : routeFreshness === 'cached' ? 'gold' : 'blue'}`}/>{routeLoading ? 'Updating safest route in background…' : routeData ? `${routeData.alternatives_considered} route options considered` : 'Map ready · route not calculated'}</span>{guidanceActive && <span className="navigation-live"><i className="status-dot blue"/> Navigation active</span>}</div>
    {routeError && <div className="route-status-banner" role="status"><span>⚡</span><p>{routeError}</p><button type="button" onClick={retryRoute}>Retry route</button></div>}
    <div className="map-layout"><CitizenSafetyMap center={mapCenter} hasLocation={Boolean(browserLocation)} guidanceActive={guidanceActive} route={routeData} onPlaceLabel={setPlaceLabel}/>
      <aside className="route-panel" data-react-route-analysis><span className="safe-eyebrow">{guidanceActive ? 'ACTIVE GUIDANCE' : 'RECOMMENDED EVACUATION'}</span><h2>{routeData && !routeIsRecommended ? 'No route currently recommended' : routeData?.destination_name ?? (routeLoading ? 'Finding a safe destination…' : 'Use your location first')}</h2>{browserLocation && <div className="route-origin-card"><span>STARTING FROM</span><strong>{placeLabel.primary}</strong><small>{placeLabel.secondary}</small></div>}<CitizenRouteAnalysis route={routeData} loading={routeLoading}/><div className="route-metrics"><div><strong>{routeIsRecommended && routeData ? formatDuration(routeData.duration_s) : '—'}</strong><span>ETA</span></div><div><strong>{routeIsRecommended && routeData ? formatDistance(routeData.distance_m) : '—'}</strong><span>Distance</span></div><div><strong>{routeIsRecommended && routeData ? `${routeData.prototype_safety_score}/100` : '—'}</strong><span>Prototype safety</span></div></div><div className={`route-safety-note ${routeFreshness === 'cached' ? 'cached-route-note' : ''}`}><strong>{routeData && !routeIsRecommended ? 'Route not approved by hazard screening' : routeData ? (routeFreshness === 'cached' ? '✓ Recent route kept on screen' : '✓ Real road route calculated') : 'Waiting for current GPS'}</strong><p>{routeData ? `Compared ${routeData.alternatives_considered} road/destination options. Safety score is a prototype heuristic, not an official flood-clearance rating.` : 'Tap Use my location to find nearby facilities and calculate road routes.'}</p></div>{routeData && <button type="button" className="figma-secondary why-route-button" onClick={() => setShowRouteReasons(v => !v)}>WHY THIS ROUTE?</button>}{showRouteReasons && routeData && <div className="route-safety-note"><strong>Why JalRakshak chose this</strong>{routeData.reasons.map(reason => <p key={reason}>• {reason}</p>)}<p><b>Source:</b> {routeData.source}</p><p>{routeData.warning}</p></div>}<div className="route-steps">{routeIsRecommended && routeData ? dynamicSteps.slice(0,6).map((step,index)=><div key={`${step.title}-${index}`} className={`${guidanceActive && index===guidanceStep?'current-step':''} ${guidanceActive && index<guidanceStep?'completed-step':''}`}><b>{guidanceActive&&index<guidanceStep?'✓':index+1}</b><span><strong>{step.title}</strong><small>{step.detail}</small></span></div>) : <div className="route-empty-state"><b>…</b><span><strong>Map is ready</strong><small>Routing loads separately so you can keep panning and zooming.</small></span></div>}</div>{!guidanceActive ? <button type="button" className="figma-primary route-start" onClick={startGuidance} disabled={!routeIsRecommended}>START GUIDANCE</button> : guidanceComplete ? <button type="button" className="figma-primary route-start guidance-finish" onClick={stopGuidance}>FINISH GUIDANCE</button> : <div className="guidance-actions"><button type="button" className="figma-primary route-start" onClick={advanceGuidance}>NEXT STEP</button><button type="button" className="figma-secondary guidance-stop" onClick={stopGuidance}>END GUIDANCE</button></div>}<button type="button" className="figma-danger-button route-help" onClick={requestHelp}>I CAN'T EVACUATE — GET HELP</button></aside></div>
    <div className="map-bottom-cards"><article><span>📍</span><div><strong>{browserLocation ? placeLabel.primary : 'Location names ready'}</strong><small>{browserLocation ? placeLabel.secondary : 'Use GPS to identify your road and neighborhood'}</small></div></article><article><span>🏫</span><div><strong>{routeData?.destination_name ?? 'Nearby facility lookup'}</strong><small>{routeData ? routeData.destination_type.replace('_',' ') : 'OpenStreetMap facilities'}</small></div></article><article><span>📡</span><div><strong>{routeFreshness === 'cached' ? 'Recent route fallback active' : guidanceActive ? 'Guidance mode active' : routeData ? 'Route calculated' : 'Routing ready when requested'}</strong><small>{routeFreshness === 'cached' ? 'Refreshing live route in background' : 'OpenStreetMap + OSRM'}</small></div></article></div>
  </section>;

  const renderSecondaryPanel = () => { if (activeNav === 'Emergency Help') return <CitizenEmergencyHelp citizenId={session?.user.id ?? 'citizen-demo'} citizenName={displayName} fallbackLatitude={mapCenter.latitude} fallbackLongitude={mapCenter.longitude} hasLocation={Boolean(browserLocation)} onBack={() => setActiveNav('Overview')}/>; return <section className="figma-placeholder-panel"><span className="safe-eyebrow">{activeNav.toUpperCase()}</span><h2>{activeNav}</h2><p>{`${activeNav} is the next Citizen module to connect. The application shell and navigation are now in place.`}</p><button type="button" className="figma-secondary back-overview" onClick={() => setActiveNav('Overview')}>Back to overview</button></section>; };
  const renderActiveScreen = () => activeNav === 'Overview' ? renderOverview() : activeNav === 'Live Map' ? renderLiveMap() : renderSecondaryPanel();

  return <main className="figma-citizen-app"><aside className="figma-sidebar"><div className="sidebar-brand-row"><div className="sidebar-logo">⌄</div><div><strong>JalRakshak</strong><span>Citizen Safety</span></div><button type="button" className="collapse-button" aria-label="Collapse navigation">‹</button></div><div className="citizen-badge">CITIZEN</div><nav className="figma-nav" aria-label="Citizen navigation">{navItems.map(item => <button key={item.label} type="button" className={`${activeNav===item.label?'active':''} ${item.label==='Emergency Help'?'emergency-nav':''} ${item.muted?'muted-nav':''}`} onClick={() => setActiveNav(item.label)}><span className="nav-icon">{item.icon}</span><span>{item.label}</span>{item.badge?<b>{item.badge}</b>:null}</button>)}</nav><div className="sidebar-user"><div className="user-avatar">{initials}</div><div><strong>{displayName}</strong><span>Citizen User</span></div><button type="button" onClick={signOut} title="Sign out">↪</button></div></aside><section className="figma-main-shell"><header className="figma-topbar"><div className="location-line">⌖ &nbsp; {`${placeLabel.primary} · ${placeLabel.secondary}`} &nbsp;·&nbsp; {browserLocation ? 'GPS' : 'MAP PREVIEW'}</div><div className="topbar-controls"><span className="live-status"><i/><i/> LIVE</span><button type="button" className="topbar-icon" aria-label="Notifications">♢<b>1</b></button><button type="button" className="language-button">EN</button><span className="topbar-avatar">{initials}</span></div></header><div className="figma-page-content">{renderActiveScreen()}</div></section>{showCriticalAlert && activeNav==='Overview' && <div className="critical-modal-backdrop" role="presentation"><section className="critical-modal" role="dialog" aria-modal="true" aria-labelledby="critical-alert-title"><div className="critical-modal-accent"/><div className="critical-modal-title-row"><div className="critical-icon">△</div><div><span>CRITICAL FLOOD WARNING</span><h2 id="critical-alert-title">Your area has entered a critical flood-risk state</h2></div></div><div className="critical-score-box"><div><span>RISK SCORE</span><strong>87</strong></div><div><span>UPDATED</span><strong>just now</strong></div></div><p className="critical-copy"><strong>Recommended action:</strong> Begin evacuation toward your assigned safe destination immediately.</p><button type="button" className="critical-guide" onClick={openGuide}>GUIDE ME</button><div className="critical-actions"><button type="button" className="critical-help" onClick={requestHelp}>I NEED HELP</button><button type="button" className="critical-details" onClick={() => setShowCriticalAlert(false)}>View Details</button></div></section></div>}</main>;
}
