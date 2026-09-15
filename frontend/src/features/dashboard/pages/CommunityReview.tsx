import { useEffect, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import './CommunityReview.css';

type Report = {
  id: string; label: string; kind: string; latitude: number; longitude: number;
  status: string; created_at: string; updated_at: string; review_state: string;
  review_version: number; review_note: string; has_photo: boolean; reporter_source: string;
};
type ReviewEvent = { id: string; decision: string; note: string; created_at: string };
const stateLabel = (state: string) => ({ reviewed_active: 'Reviewed · active', unreviewed: 'Needs review', expired: 'Stale · needs review' }[state] ?? state.replaceAll('_', ' '));

export default function CommunityReview() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [history, setHistory] = useState<ReviewEvent[]>([]);
  const selected = reports.find(report => report.id === selectedId);

  async function load() {
    try {
      const data = await apiRequest<Report[]>('/mobile/community');
      setReports(data);
      setSelectedId(current => data.some(report => report.id === current) ? current : data[0]?.id ?? null);
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load reports.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    setNote(''); setPhoto(null); setHistory([]); setSuccess('');
    if (!selectedId) return;
    let active = true;
    apiRequest<ReviewEvent[]>(`/mobile/community/${selectedId}/history`)
      .then(data => { if (active) setHistory(data); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load review history.'); });
    return () => { active = false; };
  }, [selectedId]);

  async function decide(decision: 'reviewed_active' | 'rejected') {
    if (!selected || busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const updated = await apiRequest<Report>(`/mobile/community/${selected.id}/review`, {
        method: 'POST', body: JSON.stringify({ decision, note: note.trim(), expected_version: selected.review_version }),
      });
      setReports(current => current.map(report => report.id === updated.id ? updated : report));
      setNote('');
      setSuccess(decision === 'reviewed_active'
        ? 'Review saved. New native route assessments will exclude candidates near this report.'
        : 'Report rejected and removed from active hazard markers.');
      const events = await apiRequest<ReviewEvent[]>(`/mobile/community/${updated.id}/history`);
      setHistory(events);
    } catch (err) { setError(err instanceof Error ? err.message : 'Review could not be saved.'); }
    finally { setBusy(false); }
  }
  async function changeLegacyStatus(status: 'active' | 'resolved') {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      await apiRequest(`/hazards/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await load(); setSuccess(status === 'active' ? 'Report reopened. A new review is required.' : 'Road report marked resolved. Assistance requests are unchanged.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update the report.'); }
    finally { setBusy(false); }
  }
  async function loadPhoto() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ data_url: string }>(`/hazards/${selected.id}/photo`);
      setPhoto(result.data_url);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load photo.'); }
    finally { setBusy(false); }
  }
  return <section className="signal-review-page">
    <header className="signal-review-header">
      <div><span className="signal-eyebrow">WAYSIGNAL · COMMUNITY REVIEW</span><h1>Turn observations into action.</h1>
        <p>Review evidence, explain your decision, and update the next route assessment.</p></div>
      <button type="button" onClick={() => void load()} disabled={busy}>Refresh reports</button>
    </header>
    <div className="signal-review-notice">Project review is not official road certification. Route screening checks proximity to reported points; conditions elsewhere remain unknown.</div>
    {error && <div className="signal-error" role="alert">{error}</div>}
    {success && <div className="signal-success" role="status">{success}</div>}
    <div className="signal-review-grid">
      <aside className="signal-review-queue" aria-label="Community observations">
        <h2>Observations <span>{reports.length}</span></h2>
        {loading ? <p>Loading reports…</p> : reports.length === 0 ? <p>No observations yet. Submit one from the native app or the existing citizen map.</p> : reports.map(report =>
          <button type="button" key={report.id} disabled={busy} className={selectedId === report.id ? 'selected' : ''} onClick={() => setSelectedId(report.id)}>
            <strong>{report.label}</strong><span className={`signal-status ${report.review_state}`}>{stateLabel(report.review_state)}</span>
            <small>{report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}</small>
            <small>{new Date(report.created_at).toLocaleString()}</small>
          </button>)}
      </aside>
      <article className="signal-review-detail">
        {!selected ? <p>Select an observation to review its evidence.</p> : <>
          <div className="signal-detail-heading"><div><small>{selected.id}</small><h2>{selected.label}</h2></div><span className={`signal-status ${selected.review_state}`}>{stateLabel(selected.review_state)}</span></div>
          <dl><div><dt>Source</dt><dd>{selected.reporter_source} observation</dd></div><div><dt>Reported</dt><dd>{new Date(selected.created_at).toLocaleString()}</dd></div>
            <div><dt>Coordinates</dt><dd>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</dd></div><div><dt>Review version</dt><dd>{selected.review_version}</dd></div></dl>
          <iframe title="Reported location on OpenStreetMap" loading="lazy" referrerPolicy="no-referrer" src={`https://www.openstreetmap.org/export/embed.html?bbox=${selected.longitude - 0.005}%2C${selected.latitude - 0.004}%2C${selected.longitude + 0.005}%2C${selected.latitude + 0.004}&layer=mapnik&marker=${selected.latitude}%2C${selected.longitude}`}/>
          {selected.has_photo && !photo && <button type="button" disabled={busy} onClick={() => void loadPhoto()}>View attached photo</button>}
          {photo && <img className="signal-evidence-photo" src={photo} alt="Photo supplied with the selected community observation"/>}
          {selected.review_note && <blockquote>{selected.review_note}</blockquote>}
          {selected.status === 'active' ? <>
            <label className="signal-note">Review note <span>Visible to the community</span><textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={3} disabled={busy} placeholder="Describe the evidence and any uncertainty."/></label>
            <div className="signal-review-actions">
              <button type="button" className="primary" disabled={busy || !note.trim()} onClick={() => void decide('reviewed_active')}>Confirm active hazard</button>
              <button type="button" disabled={busy || !note.trim()} onClick={() => void decide('rejected')}>Reject report</button>
              <button type="button" disabled={busy} onClick={() => void changeLegacyStatus('resolved')}>Mark road report resolved</button>
            </div>
          </> : <button type="button" disabled={busy} onClick={() => void changeLegacyStatus('active')}>Reopen for review</button>}
          <p className="signal-review-footer">Finishing an assistance request does not clear a road report. These are separate workflows.</p>
          <h3>Review history</h3>
          {history.length === 0 ? <p>No review decisions recorded yet.</p> : <ol className="signal-review-history">{history.map(event => <li key={event.id}><strong>{stateLabel(event.decision)}</strong><time>{new Date(event.created_at).toLocaleString()}</time><p>{event.note}</p></li>)}</ol>}
        </>}
      </article>
    </div>
  </section>;
}
