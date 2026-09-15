import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { authSession } from '../auth/auth-session';
import { apiRequest } from '../../lib/api-client';
import { citizenSafetyApi, type EmergencyRecord, type SafetyContext } from '../dashboard/api/citizen-safety.api';
import { useScenario } from './ScenarioContext';

type Report = { id: string; label: string; latitude: number; longitude: number; review_state: string; review_version: number; review_note: string };
type Candidate = { id: string; geometry: number[][]; distance_m: number; duration_s: number; excluded: boolean; findings: { report_id: string; label: string; review_state: string }[] };
type Assessment = { selected_id: string | null; candidates: Candidate[]; notice: string; generated_at: string };
type Guide = { text: string; sources: { id: string; status: string }[] };
const label = (state: string) => state.replaceAll('_', ' ');

export default function ScenarioPage() {
  const scenario = useScenario();
  const session = authSession.get();
  const worker = session?.user.role === 'worker';
  const [reports, setReports] = useState<Report[]>([]);
  const [requests, setRequests] = useState<EmergencyRecord[]>([]);
  const [weather, setWeather] = useState<SafetyContext | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = { origin: scenario.origin, destination: scenario.destination, destination_name: scenario.destination_name };
  async function load() {
    if (!scenario.origin) return;
    setBusy(true); setError('');
    try {
      const [nextReports, nextRequests, context, route] = await Promise.all([
        apiRequest<Report[]>('/mobile/community'), citizenSafetyApi.listEmergencies(),
        citizenSafetyApi.getContext(scenario.origin.latitude, scenario.origin.longitude),
        apiRequest<Assessment>('/mobile/routes/assess', { method: 'POST', body: JSON.stringify(input) }),
      ]);
      setReports(nextReports); setRequests(nextRequests); setWeather(context); setAssessment(route);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not refresh the exercise.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (session && scenario.enabled) void load(); }, [scenario.enabled]);
  async function review(report: Report) {
    setBusy(true); setError(''); setGuide(null);
    try {
      await apiRequest(`/mobile/community/${report.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'reviewed_active', note: 'Demo responder: confirmed the scripted obstruction for this exercise.', expected_version: report.review_version }) });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save review.'); }
    finally { setBusy(false); }
  }
  async function assign(request: EmergencyRecord) {
    if (!session) return;
    setBusy(true); setError('');
    try {
      await citizenSafetyApi.updateEmergency(request.id, { status: 'assigned', responder_id: session.user.id, responder_name: 'Demo response team' });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not assign request.'); }
    finally { setBusy(false); }
  }
  async function explain() {
    setBusy(true); setError(''); setGuide(null);
    try { setGuide(await apiRequest<Guide>('/mobile/guide', { method: 'POST', body: JSON.stringify({ action: 'route', route: input }) }, 35000)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Source summary unavailable.'); }
    finally { setBusy(false); }
  }
  async function reset() {
    if (!window.confirm('Reset the five scripted reports and six scripted assistance requests? Custom records are retained.')) return;
    setBusy(true); setGuide(null); setError('');
    try { await apiRequest('/mobile/scenario/reset', { method: 'POST' }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not reset exercise.'); }
    finally { setBusy(false); }
  }
  if (!session) return <Navigate to="/" replace/>;
  if (!scenario.enabled) return <main className="scenario-page"><h1>Demo scenario is off</h1><p>Start the dedicated demo server using scripts/start-demo.sh to use synthetic data.</p><Link to={worker ? '/responder' : '/citizen'}>Return to workspace</Link></main>;
  const point = (latitude: number, longitude: number) => `${40 + (longitude - 85.321) / .012 * 600},${190 - (latitude - 27.7172) / .004 * 170}`;
  return <main className="scenario-page">
    <header className="scenario-page-header"><div><p className="scenario-eyebrow">WAYSIGNAL / REPEATABLE DEMO</p><h1>{scenario.title}</h1><p>One observation changes the next route. One assignment changes the next step.</p></div>
      <div className="scenario-actions"><Link to={worker ? '/responder' : '/citizen'}>Full {worker ? 'responder' : 'citizen'} workspace</Link><button disabled={busy} onClick={() => void load()}>Refresh</button>{worker && <button disabled={busy} onClick={() => void reset()}>Reset exercise</button>}</div></header>
    {error && <p className="scenario-error" role="alert">{error} Earlier results may be stale.</p>}
    {busy && <p role="status">Updating exercise…</p>}
    <section className="scenario-metrics" aria-label="Synthetic exercise conditions">
      <article><span>SIMULATED RAIN · NEXT 6H</span><strong>{weather ? `${weather.precipitation_next_6h_mm} mm` : 'Loading…'}</strong><small>Fictional weather snapshot</small></article>
      <article><span>SIMULATED RIVER TREND</span><strong>{weather ? `+${weather.river_trend_percent}%` : 'Loading…'}</strong><small>{weather ? `${weather.river_discharge_m3s} m³/s in the scenario` : 'No reading loaded'}</small></article>
      <article><span>COMMUNITY SIGNALS</span><strong>{reports.length}</strong><small>{reports.filter(r => r.review_state === 'unreviewed').length} awaiting review</small></article>
      <article><span>ASSISTANCE REQUESTS</span><strong>{requests.length}</strong><small>{requests.filter(r => r.status === 'submitted').length} awaiting assignment in your view</small></article>
    </section>
    <div className="scenario-columns">
      <section className="scenario-card"><div className="scenario-card-heading"><h2>See the route change</h2><span>SCHEMATIC · DEMO</span></div>
        <svg viewBox="0 0 690 350" role="img" aria-label="Schematic of three fictional route candidates and reported hazards">
          <rect width="690" height="350" rx="18" fill="#eaf0f7"/>
          {[60,130,200,270].map(y => <path key={y} d={`M0 ${y}H690`} stroke="#fff" strokeWidth="12"/>)}
          {[100,220,340,460,580].map(x => <path key={x} d={`M${x} 0V350`} stroke="#fff" strokeWidth="10"/>)}
          {assessment?.candidates.map(route => <polyline key={route.id} points={route.geometry.map(([lat, lon]) => point(lat, lon)).join(' ')} fill="none" stroke={route.excluded ? '#b42318' : route.id === assessment.selected_id ? '#155eef' : '#7e8ca2'} strokeWidth={route.id === assessment.selected_id ? 8 : 5} strokeDasharray={route.excluded ? '10 6' : undefined}/>) }
          {reports.filter(r => ['WS-DEMO-R104','WS-DEMO-R105','WS-DEMO-R101'].includes(r.id)).map(r => { const [cx,cy] = point(r.latitude,r.longitude).split(','); return <g key={r.id}><circle cx={cx} cy={cy} r="13" fill={r.review_state === 'reviewed_active' ? '#b42318' : '#9a5700'} stroke="white" strokeWidth="3"/><text x={Number(cx)+18} y={Number(cy)-15} fontSize="14" fill="#14253d">{r.id.replace('WS-DEMO-', '')}</text></g>; })}
          <circle cx="40" cy="190" r="10" fill="#14253d"/><circle cx="640" cy="190" r="10" fill="#155eef"/>
          <text x="22" y="225" fontSize="14">Start</text><text x="515" y="225" fontSize="14">Demo destination</text>
        </svg>
        <p className="scenario-instruction">Confirm report <strong>R104</strong> to exclude the direct candidate. The northern alternative should then become selected.</p>
        {assessment?.candidates.map(route => <div className="scenario-route" key={route.id}><strong>{route.id}</strong><span>{Math.ceil(route.duration_s/60)} simulated min · {(route.distance_m/1000).toFixed(1)} km</span><b className={route.excluded ? 'closed' : ''}>{route.excluded ? 'Excluded' : route.id === assessment.selected_id ? 'Selected' : 'Alternative'}</b></div>)}
        <button className="primary" disabled={busy} onClick={() => void explain()}>Explain with source records</button>
        {guide && <div className="scenario-guide"><strong>Guide · source summary</strong><p>{guide.text}</p>{guide.sources.map(source => <small key={source.id}>{source.id} · {label(source.status)}<br/></small>)}</div>}
        <small className="scenario-footnote">Simulated routes and travel times. The schematic is not a road map or travel guidance.</small>
      </section>
      <section className="scenario-card"><h2>Community observations</h2>{reports.map(report => <article className="scenario-report" key={report.id}><div><strong>{report.label}</strong><small>{report.id}</small></div><span className={`scenario-state ${report.review_state}`}>{label(report.review_state)}</span>{report.review_note && <p>{report.review_note}</p>}{worker && report.review_state === 'unreviewed' && <button disabled={busy} onClick={() => void review(report)}>Confirm active hazard</button>}</article>)}</section>
    </div>
    <section className="scenario-card"><h2>Assistance progress</h2><div className="scenario-request-grid">{requests.map(request => <article key={request.id}><small>DEMO · {request.id}</small><h3>{request.citizen_name}</h3><p>{request.emergency_type} · {request.people_count} people</p><span className={`scenario-state ${request.status}`}>{label(request.status)}</span><p>{request.responder_name || 'Awaiting assignment'}</p>{worker && request.status === 'submitted' && <button disabled={busy} onClick={() => void assign(request)}>Assign demo team</button>}</article>)}</div></section>
    <p className="scenario-footnote">{scenario.notice} Completing assistance does not clear a road report. Refresh the other signed-in view to see changes.</p>
  </main>;
}
