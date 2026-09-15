import { useEffect, useState } from 'react';
import { reportsApi, type Measurement, type ReportFilters, type ReportsData } from '../api/reports.api';
import './OperationalReports.css';

const labels: Record<string, string> = { rescue: 'Rescue / trapped', medical: 'Medical', evacuation: 'Evacuation', submitted: 'Submitted', assigned: 'Assigned', en_route: 'En route', resolved: 'Resolved', cancelled: 'Cancelled', critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low', unknown: 'Unknown', medium: 'Medium', stale: 'Stale' };
const bands = ['critical', 'high', 'moderate', 'low', 'unknown'] as const;
const colors = { critical: '#a92326', high: '#cd691d', moderate: '#e8bf7c', low: '#43936c', unknown: '#b3aca1' };
const qualityColors = { high: '#298357', medium: '#9d852f', low: '#cd691d', stale: '#a92326', unknown: '#b3aca1' };
const timingLabels: Record<keyof ReportsData['timings'], string> = { acknowledgment: 'Acknowledgment', assignment: 'Assignment', dispatch: 'Dispatch / en route', arrival: 'On scene', resolution: 'Resolution' };

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dateRange(days: number) {
  const start = new Date(); start.setDate(start.getDate() - days + 1);
  return { start_date: localDate(start), end_date: localDate() };
}
function elapsed(seconds: number | null) {
  if (seconds === null) return '—';
  const value = Math.round(seconds);
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor(value % 3600 / 60)}m`;
}
const percent = (count: number, total: number) => total ? `${Math.round(count * 100 / total)}%` : '—';
const number = (value: number) => value.toLocaleString();

function Metric({ label, value, note, tone = '' }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`report-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
function Timing({ title, value }: { title: string; value: Measurement }) {
  return <Metric label={`Avg ${title.toLowerCase()}`} value={elapsed(value.seconds)} note={`${value.samples} recorded ${value.samples === 1 ? 'incident' : 'incidents'}`}/>;
}
function Bars({ values, total, quality = false }: { values: Array<{ key: string; count: number }>; total: number; quality?: boolean }) {
  const palette: Record<string, string> = quality ? qualityColors : colors;
  return <div className="report-bars">{values.map(item => <div key={item.key}><div><span>{labels[item.key] ?? item.key}</span><b>{number(item.count)}{quality ? ` · ${percent(item.count, total)}` : ''}</b></div><div className="report-track"><i style={{ width: `${total ? item.count / total * 100 : 0}%`, background: palette[item.key] ?? '#95813e' }}/></div></div>)}</div>;
}
function Trend({ data }: { data: ReportsData['trend'] }) {
  const max = Math.max(4, ...data.map(row => row.total));
  const top = Math.ceil(max / 4) * 4;
  const width = Math.max(650, data.length * 36);
  const stride = (width - 70) / data.length;
  return <>
    <div className="report-chart-scroll"><svg viewBox={`0 0 ${width} 285`} style={{ minWidth: width }} role="img" aria-label="Daily incident counts by recorded prototype risk. Exact values are available in the table below.">
      {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="45" x2={width - 15} y1={230 - i * 50} y2={230 - i * 50} stroke="#e9e3d9"/><text x="34" y={235 - i * 50} textAnchor="end">{top * i / 4}</text></g>)}
      {data.map((row, i) => {
        let offset = 0;
        return <g key={row.date}>
          {[...bands].reverse().map(band => {
            const height = row[band] / top * 200; offset += height;
            return <rect key={band} x={45 + i * stride + stride * .2} y={230 - offset} width={stride * .6} height={height} fill={colors[band]} rx="2"><title>{row.date}: {labels[band]} {row[band]}</title></rect>;
          })}
          <text x={45 + i * stride + stride / 2} y={222 - row.total / top * 200} textAnchor="middle">{row.total}</text>
          <text x={45 + i * stride + stride / 2} y="254" textAnchor="middle">{new Date(`${row.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>
        </g>;
      })}
    </svg></div>
    <div className="report-legend">{bands.map(band => <span key={band}><i style={{ background: colors[band] }}/>{labels[band]}</span>)}</div>
    <details className="report-data-table"><summary>View daily counts</summary><div className="report-table-scroll"><table><thead><tr><th>Date</th><th>Total</th>{bands.map(band => <th key={band}>{labels[band]}</th>)}</tr></thead><tbody>{data.map(row => <tr key={row.date}><td>{row.date}</td><td>{row.total}</td>{bands.map(band => <td key={band}>{row[band]}</td>)}</tr>)}</tbody></table></div></details>
  </>;
}

export default function OperationalReports({ onOpenIncident }: { onOpenIncident: (id: string) => void }) {
  const [filters, setFilters] = useState<ReportFilters>(() => ({ ...dateRange(7), timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', severity: '', incident_type: '', status: '', location: '', page: 1 }));
  const [range, setRange] = useState('7');
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [locationDraft, setLocationDraft] = useState('');
  const [locationError, setLocationError] = useState('');
  const queryKey = JSON.stringify(filters);
  useEffect(() => {
    let alive = true;
    let pending = false;
    setData(null); setLoading(true); setError(''); setExportError('');
    const query: ReportFilters = JSON.parse(queryKey);
    if (!query.start_date || !query.end_date) {
      setLoading(false); setError('Choose both a start date and an end date.');
      return () => { alive = false; };
    }
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await reportsApi.get(query);
        if (alive) { setData(next); setError(''); }
      } catch (failure) {
        if (alive) setError(failure instanceof Error ? failure.message : 'Unable to load reports.');
      } finally { pending = false; if (alive) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [queryKey, refresh]);

  const change = (key: keyof ReportFilters, value: string) => {
    if (key === 'location') { setLocationDraft(value); setLocationError(''); }
    setFilters(current => ({ ...current, [key]: value, page: 1 }));
  };
  const applyLocation = () => {
    const value = locationDraft.trim();
    if (value) {
      const match = value.match(/^([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))\s*,\s*([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))$/);
      if (!match) { setLocationError('Enter latitude, longitude, for example 29.718, -95.402.'); return; }
      const latitude = Number(match[1]), longitude = Number(match[2]);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) { setLocationError('Latitude must be between -90 and 90.'); return; }
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) { setLocationError('Longitude must be between -180 and 180.'); return; }
    }
    change('location', value);
  };
  const download = async () => {
    setExporting(true); setExportError('');
    try { await reportsApi.export(filters); }
    catch (failure) { setExportError(failure instanceof Error ? failure.message : 'Export failed. Please retry.'); }
    finally { setExporting(false); }
  };
  const rows = data?.rows ?? [];
  const measuredTimings = data ? (Object.entries(data.timings) as Array<[keyof ReportsData['timings'], Measurement]>).filter(([, value]) => value.seconds !== null && value.samples > 0) : [];
  const unmeasuredTimings = data ? Object.keys(timingLabels).filter(key => !measuredTimings.some(([measured]) => measured === key)).map(key => timingLabels[key as keyof typeof timingLabels]) : [];
  const hasAreaTiming = data?.locations_summary.some(area => area.assignment.seconds !== null && area.assignment.samples > 0);

  const incidentTable = data && <>
    <div className="report-table-scroll"><table><thead><tr><th>Incident</th><th>Created</th><th>Type</th><th>Status</th><th>People</th><th>Time to assign</th><th>Time to resolve</th><th>Action</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.id}</strong><small>GPS {row.location}</small></td><td>{new Date(row.created_at).toLocaleString()}</td><td>{labels[row.incident_type]}</td><td><span className={`report-status ${row.status}`}>{labels[row.status]}</span></td><td>{row.people_count}</td><td>{row.assignment_seconds !== null ? elapsed(row.assignment_seconds) : <span className="report-missing">{row.status === 'submitted' ? 'Not assigned' : 'Time not recorded'}</span>}</td><td>{row.resolution_seconds !== null ? elapsed(row.resolution_seconds) : <span className="report-missing">{row.status === 'resolved' ? 'Time not recorded' : row.status === 'cancelled' ? 'Cancelled' : 'Not resolved'}</span>}</td><td><button disabled={row.status === 'cancelled'} onClick={() => onOpenIncident(row.id)}>Open incident</button></td></tr>)}</tbody></table></div>
    {rows.length === 0 && <p className="report-empty">No incidents match these filters.</p>}
    <div className="report-pagination"><span>{number(data.summary.total)} matching incidents · page {data.page} of {data.page_count}</span><button disabled={data.page <= 1} onClick={() => setFilters(current => ({ ...current, page: data.page - 1 }))}>Previous</button><button disabled={data.page >= data.page_count} onClick={() => setFilters(current => ({ ...current, page: data.page + 1 }))}>Next</button></div>
  </>;

  return <section className="operational-reports" data-operational-reports>
    <header className="report-header"><div><div className="report-title"><h1>Reports</h1><span className={`report-source ${error ? 'stale' : ''}`}>{error ? 'DATA UNAVAILABLE / STALE' : 'BACKEND RECORDS'}</span></div><p>Operational performance & incident analysis</p></div>
      <div className="report-controls">
        <label><span>Date range</span><select aria-label="Date range" value={range} onChange={event => { const value = event.target.value; setRange(value); if (value !== 'custom') setFilters(current => ({ ...current, ...dateRange(Number(value)), page: 1 })); }}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom dates</option></select></label>
        <form className="report-gps-filter" aria-label="Filter reports by GPS" onSubmit={event => { event.preventDefault(); applyLocation(); }}>
          <label htmlFor="report-gps-input"><span>GPS location</span></label>
          <div className="report-gps-entry"><input id="report-gps-input" aria-label="GPS location" type="text" list="report-gps-suggestions" placeholder="All locations · lat, longitude" value={locationDraft} maxLength={64} autoComplete="off" spellCheck={false} aria-invalid={Boolean(locationError)} aria-describedby={locationError ? 'report-gps-error' : 'report-gps-help'} onChange={event => { setLocationDraft(event.target.value); setLocationError(''); }}/><button type="submit" aria-label="Apply GPS filter">Apply</button>{(locationDraft || filters.location) && <button type="button" aria-label="Clear GPS filter" onClick={() => change('location', '')}>Clear</button>}</div>
          <datalist id="report-gps-suggestions">{(data?.locations ?? []).map(location => <option key={location} value={location}/>)}</datalist>
          <small id="report-gps-help">Type coordinates or choose a suggestion.</small>
          {locationError && <p id="report-gps-error" role="alert">{locationError}</p>}
        </form>
        <label><span>Prototype risk</span><select aria-label="Prototype risk" value={filters.severity} onChange={event => change('severity', event.target.value)}><option value="">All risk levels</option>{bands.map(band => <option key={band} value={band}>{labels[band]}</option>)}</select></label>
        <label><span>Incident type</span><select aria-label="Incident type" value={filters.incident_type} onChange={event => change('incident_type', event.target.value)}><option value="">All types</option>{['rescue', 'medical', 'evacuation'].map(type => <option key={type} value={type}>{labels[type]}</option>)}</select></label>
        <label><span>Status</span><select aria-label="Status" value={filters.status} onChange={event => change('status', event.target.value)}><option value="">All statuses</option>{['submitted', 'assigned', 'en_route', 'resolved', 'cancelled'].map(status => <option key={status} value={status}>{labels[status]}</option>)}</select></label>
        <button className="report-export" disabled={exporting || loading || !data || Boolean(error)} onClick={() => void download()}>{exporting ? 'Exporting…' : '↓ Export CSV'}</button>
      </div>
    </header>
    {range === 'custom' && <div className="report-custom-dates"><label>From <input aria-label="Start date" type="date" value={filters.start_date} max={localDate()} onChange={event => change('start_date', event.target.value)}/></label><label>Through <input aria-label="End date" type="date" value={filters.end_date} max={localDate()} onChange={event => change('end_date', event.target.value)}/></label><span>Up to 93 calendar days.</span></div>}
    <div className="report-freshness"><span>Seeded demo incidents excluded · dates in {filters.timezone_name}{data?.filters.location && <span className="report-gps-applied">GPS filter: {data.filters.location} · rounded to 3 decimals</span>}{locationDraft.trim() !== filters.location && <span className="report-gps-pending">GPS edit not applied. Reports and exports use the applied filter.</span>}</span><span>{data ? `Updated ${new Date(data.generated_at).toLocaleTimeString()} · refreshes every 15s` : 'Reading backend…'} <button onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh</button></span></div>
    {(error || exportError) && <div className="report-error" role="alert">{error || exportError}{error && data && ' Displaying the last successful snapshot.'} <button onClick={() => error ? setRefresh(value => value + 1) : void download()}>Retry</button></div>}
    {loading && <p className="report-empty" role="status">Loading operational reports…</p>}
    {data && <>
      <div className="report-metrics">
        <Metric label="Total incidents" value={number(data.summary.total)} note="Created in the selected period"/>
        <Metric label="Active incidents" value={number(data.summary.active)} note="Submitted, assigned, or en route"/>
        <Metric label="People in active incidents" value={number(data.summary.people_in_active)} note="Reported group sizes awaiting completion" tone="gold"/>
        <Metric label="Resolved" value={number(data.summary.resolved)} note={data.summary.resolution_percent === null ? 'No incidents in this selection' : `${data.summary.resolution_percent}% of matching incidents`} tone="resolved"/>
        <Metric label="People in resolved incidents" value={number(data.summary.people_in_resolved)} note="Reported group sizes; not verified rescues" tone="gold"/>
        <Metric label="Critical risk snapshots" value={number(data.summary.critical)} note={data.summary.total ? `${percent(data.summary.critical, data.summary.total)} of incidents · prototype score` : 'No incidents in this selection'} tone="critical"/>
      </div>
      <div className="report-tabs" role="tablist" aria-label="Report sections">{['overview', 'response', 'evacuation', 'after-action'].map(value => <button key={value} id={`report-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="report-panel" className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value.replace('-', ' ')}</button>)}</div>
      <div className="report-content" role="tabpanel" id="report-panel" aria-labelledby={`report-tab-${tab}`}>
        {data.summary.total === 0 && <p className="report-empty">No non-demo incidents match this period and these filters. Try a wider date range.</p>}
        {tab === 'overview' && <>
          <div className="report-overview-grid"><article className="report-card report-trend"><h2>Incident trend · {filters.start_date} – {filters.end_date}</h2><p>Counts by creation date and recorded prototype risk.</p><Trend data={data.trend}/></article><article className="report-card"><h2>Incident breakdown</h2><Bars values={data.incident_types} total={data.summary.total}/></article></div>
          <div className="report-lower-grid"><article className="report-card"><h2>Incidents by risk</h2><div className="report-severities">{data.severity.map(item => <div key={item.key} style={{ borderColor: `${colors[item.key as keyof typeof colors]}44`, background: `${colors[item.key as keyof typeof colors]}0b` }}><span>{labels[item.key]}</span><strong style={{ color: colors[item.key as keyof typeof colors] }}>{item.count}</strong><div className="report-track"><i style={{ width: `${data.summary.total ? item.count / data.summary.total * 100 : 0}%`, background: colors[item.key as keyof typeof colors] }}/></div></div>)}</div></article>
            <article className="report-card"><h2>Location summary</h2><p>GPS groups at 3 decimal places. District boundaries are not recorded.</p><div className="report-table-scroll"><table><thead><tr><th>GPS location</th><th>Highest recorded risk</th><th>Incidents</th><th>People in active incidents</th><th>Resolved</th>{hasAreaTiming && <th>Avg assignment</th>}</tr></thead><tbody>{data.locations_summary.map(area => <tr key={area.location}><td><button className="report-location-link" onClick={() => change('location', area.location)}>{area.location}</button></td><td>{area.max_risk_score === null ? 'Unknown' : `${area.max_risk_score}/100`}</td><td>{area.incidents}</td><td>{area.active_people}</td><td className="report-green">{area.resolved}</td>{hasAreaTiming && <td>{area.assignment.seconds === null ? 'Time not recorded' : elapsed(area.assignment.seconds)}</td>}</tr>)}</tbody></table></div></article>
          </div>
          <article className="report-card"><h2>Citizen location quality</h2><p>Active incidents in the selected period. GPS timestamp freshness and reported accuracy.</p><div className="report-quality-grid"><div><Bars values={['high', 'medium', 'low', 'stale', 'unknown'].map(key => ({ key, count: data.location_quality.counts[key] }))} total={data.location_quality.total} quality/><p className="report-note">Fresh: at most 5 minutes old. High: ≤25 m; medium: ≤100 m; low: &gt;100 m. Missing accuracy or timestamps: unknown.</p></div><div className="report-quality-metrics">{data.location_quality.average_accuracy_m !== null ? <Metric label="Average GPS accuracy" value={`±${data.location_quality.average_accuracy_m} m`} note={`${data.location_quality.accuracy_samples} accuracy measurements`}/> : <Metric label="GPS accuracy measurements" value="0" note="No accuracy measurements in this selection"/>}<Metric label="Stale locations" value={number(data.location_quality.counts.stale)} note="Last GPS update over 5 minutes ago" tone="critical"/><Metric label="Unknown location quality" value={number(data.location_quality.counts.unknown)} note="Missing accuracy or usable GPS update time"/><Metric label="Fresh, high confidence" value={number(data.location_quality.counts.high)} note={`${data.location_quality.total} active incidents${data.location_quality.total ? ` · ${percent(data.location_quality.counts.high, data.location_quality.total)} high confidence` : ''}`} tone="resolved"/></div></div></article>
        </>}
        {tab === 'response' && <>
          <article className="report-card report-current-status"><h2>Current response status</h2><div className="report-response-metrics">{data.statuses.map(item => <Metric key={item.key} label={labels[item.key]} value={number(item.count)} note={data.summary.total ? `${percent(item.count, data.summary.total)} of matching incidents` : 'No matching incidents'} tone={item.key === 'resolved' ? 'resolved' : ''}/>)}</div></article>
          {measuredTimings.length > 0 ? <article className="report-card report-timings"><h2>Recorded response times</h2><p>Average time from creation to each first recorded action.</p><div className="report-response-metrics">{measuredTimings.map(([key, value]) => <Timing key={key} title={timingLabels[key]} value={value}/>)}</div>{unmeasuredTimings.length > 0 && <p className="report-note">No recorded times for: {unmeasuredTimings.join(', ')}.</p>}</article> : data.summary.total > 0 && <div className="report-history-note"><strong>Response times are not available for {data.summary.total === 1 ? 'this incident' : 'these incidents'}.</strong><p>The saved statuses are shown above. Older records may lack action times; new response actions are timed automatically.</p></div>}
          <article className="report-card"><h2>Response records</h2>{incidentTable}</article>
        </>}
        {tab === 'evacuation' && <article className="report-card"><h2>Evacuation requests</h2><p>{data.evacuation.incidents === 0 ? 'No evacuation requests match this selection. Rescue and medical requests are counted in their own categories.' : 'Evacuation assistance requests within the current filters.'}</p><div className="report-response-metrics"><Metric label="Requests" value={number(data.evacuation.incidents)} note="Recorded evacuation incidents"/><Metric label="People requesting help" value={number(data.evacuation.people)} note="Reported group sizes"/><Metric label="Resolved requests" value={number(data.evacuation.resolved)} note="Marked resolved by responders" tone="resolved"/><Metric label="People in active requests" value={number(data.evacuation.active_people)} note="Submitted, assigned, or en route"/></div>{data.evacuation.incidents > 0 && <button onClick={() => { change('incident_type', 'evacuation'); setTab('response'); }}>View evacuation records</button>}</article>}
        {tab === 'after-action' && <><article className="report-card"><h2>Incident review</h2><p>Review recorded outcomes and export all matching incident rows with their timestamps.</p><div className="report-response-metrics"><Metric label="Active" value={number(data.summary.active)} note="Awaiting completion"/><Metric label="Resolved" value={number(data.summary.resolved)} note="Recorded status" tone="resolved"/><Metric label="Cancelled" value={number(data.summary.cancelled)} note="Included in the selected cohort"/></div>{incidentTable}</article></>}
      </div>
      <footer className="report-footer"><details className="report-definitions"><summary>Data sources and missing measurements</summary><p>Counts come from saved non-demo SOS requests, including tests submitted through the live form. A zero means no matching records; an unrecorded time cannot be calculated from a status alone.</p><p>Response times use recorded actions only. GPS updates do not reset them. People counts are reported group sizes and can include the same person in multiple incidents. Risk scores are prototype estimates.</p><p>Alert delivery, shelter occupancy, and offline sync analytics are not connected yet and are omitted from these reports. They need recorded delivery events, shelter capacity/check-ins, and sync events.</p><p>Dates filter creation time; status and GPS reflect the latest saved state. CSV includes all matching rows; unrecorded measurements remain blank.</p></details><p>Source: JalRakshak emergency database · Risk: stored prototype snapshots · No simulated totals</p></footer>
    </>}
  </section>;
}
