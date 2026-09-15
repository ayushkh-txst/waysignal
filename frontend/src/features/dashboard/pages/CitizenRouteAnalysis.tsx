import type { EvacuationRoute } from '../api/citizen-safety.api';

export default function CitizenRouteAnalysis({ route, loading }: { route: EvacuationRoute | null; loading: boolean }) {
  const complete = route?.screening_status === 'complete';
  const rejected = route?.screened_routes?.filter(r => r.status === 'rejected') ?? [];
  return <section className="route-analysis-summary" aria-label="Route analysis summary">
    <div className="route-analysis-heading"><span>ROUTE ANALYSIS</span><strong>{loading ? 'Calculating road alternatives…' : route ? `${route.alternatives_considered} alternatives compared` : 'Waiting for route calculation'}</strong></div>
    <div className="route-analysis-grid">{([
      ['Analyzed', route?.alternatives_considered], ['Rejected', complete ? route?.rejected_count : null],
      ['Viable', complete ? route?.viable_count : null], ['Recommended', complete ? route?.recommended_count : null],
    ] as const).map(([label, count]) => <div key={label}><b>{count ?? '—'}</b><span>{label}</span></div>)}</div>
    <p className="route-analysis-note">{route ? route.warning : 'Use your location to calculate road routes and check shared hazard reports.'}</p>
    {rejected.length > 0 && <details className="route-analysis-details"><summary>View rejected routes</summary><div className="route-analysis-rejected-list">{rejected.map((item, index) => <article key={item.id || index}><strong>Rejected route {index + 1}</strong>{item.rejection_reasons?.map((reason, i) => <p key={i}>{reason}</p>)}</article>)}</div></details>}
  </section>;
}
