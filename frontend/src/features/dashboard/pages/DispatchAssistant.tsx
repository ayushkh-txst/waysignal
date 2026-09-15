import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dispatchApi, type AIReview, type DispatchDetail, type DispatchItem } from '../api/dispatch.api';
import type { EmergencyRecord } from '../api/citizen-safety.api';
import './DispatchAssistant.css';

const SIGNALS: Record<string, string> = { medical_support: 'Medical support mentioned', water_rescue: 'Water rescue mentioned', mobility_assistance: 'Mobility assistance mentioned', access_obstruction: 'Access obstruction mentioned' };
const message = (error: unknown) => error instanceof Error ? error.message : 'Dispatch assistance is unavailable.';
const stamp = (item: DispatchItem) => `${item.incident_id}:${item.revision}`;
function Bell() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>; }

export function DispatchAssistantCard({ incidentId, changeKey, compact = false, autoReview = false }: {
  incidentId: string; changeKey: string; compact?: boolean; autoReview?: boolean;
}) {
  const [data, setData] = useState<DispatchDetail | null>(null);
  const [error, setError] = useState('');
  const [directory, setDirectory] = useState('');
  const [retry, setRetry] = useState(0);
  const [ai, setAI] = useState<AIReview | null>(null);
  const [aiBusy, setAIBusy] = useState(false);
  const [copyState, setCopyState] = useState('');
  const request = useRef(0);
  const autoRun = useRef('');

  useEffect(() => { setDirectory(''); setAI(null); autoRun.current = ''; }, [incidentId, changeKey]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setRetry(n => n + 1); }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const serial = ++request.current;
    setData(null); setError(''); setAIBusy(false); setCopyState('');
    dispatchApi.detail(incidentId, directory).then(detail => {
      if (request.current === serial) setData(detail);
    }).catch(err => { if (request.current === serial) setError(message(err)); });
    return () => { request.current++; };
  }, [incidentId, changeKey, directory, retry]);

  const reviewNote = async (detail: DispatchDetail) => {
    const serial = request.current;
    setAIBusy(true);
    try { const result = await dispatchApi.aiReview(detail); if (request.current === serial) setAI(result); }
    catch (err) { if (request.current === serial) setAI({ revision: detail.revision, status: 'unavailable', signals: [], notice: message(err) }); }
    finally { if (request.current === serial) setAIBusy(false); }
  };
  useEffect(() => {
    if (autoReview && data?.ai_available && data.notes && autoRun.current !== stamp(data)) {
      autoRun.current = stamp(data); void reviewNote(data);
    }
  }, [data, autoReview]);

  const copy = async () => {
    if (!data) return;
    try { await navigator.clipboard.writeText(data.handoff); setCopyState('Handoff copied'); }
    catch { setCopyState('Copy unavailable. Select the handoff text below.'); }
  };

  return <article className={`dispatch-ui dispatch-assistant ${compact ? 'compact' : ''}`} data-dispatch-assistant>
    <header><span className="dispatch-eyebrow">DISPATCH ASSISTANT</span><span className="dispatch-origin">{data?.ai_available ? 'AI note review available' : 'Incident brief'}</span></header>
    {error ? <div className="dispatch-warning" role="status">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry assistance</button></div> : !data ? <p role="status">Matching the reported location to emergency contacts…</p> : <>
      <h3>{data.title}</h3><p className="dispatch-summary">{data.summary}</p>
      <div className="dispatch-services">{data.suggested_services.map(service => <span key={service}>{service}</span>)}</div>
      <div className="dispatch-location"><strong>{data.location.label}</strong><span>{data.latitude.toFixed(5)}, {data.longitude.toFixed(5)}{data.accuracy_m !== null ? ` · ±${Math.round(data.accuracy_m)} m` : ' · accuracy unknown'}</span></div>
      {data.location_stale && <p className="dispatch-warning">Location is old or its receipt time is unknown. Confirm the current location before coordinating a response.</p>}
      {!compact && data.notes && <div className="dispatch-citizen-note"><strong>Citizen note · unverified</strong><p>{data.notes}</p></div>}
      <div className="dispatch-directory-label"><strong>Emergency contacts</strong><span>{data.directory.selection}</span></div>
      {(data.location.source === 'coordinates' || !data.directory.contacts.length || directory) && <label className="dispatch-directory-picker">Browse a directory manually
        <select aria-label="Emergency contact directory" value={directory} onChange={event => setDirectory(event.target.value)}><option value="">Match incident GPS</option><option value="US">United States</option><option value="NP">Nepal</option></select>
      </label>}
      <p className="dispatch-call-note">{data.directory.notice}</p>
      <div className="dispatch-contacts">{data.directory.contacts.map(contact => <section key={contact.id} data-dispatch-contact={contact.id}>
        <div><strong>{contact.name}</strong><span>{contact.coverage}{!contact.emergency ? ' · NON-EMERGENCY' : ''}</span><small>{contact.note}</small><a className="dispatch-source" href={contact.source_url} target="_blank" rel="noreferrer">Official source · checked {contact.checked_on}</a></div>
        <a className="dispatch-call" href={`tel:${contact.phone}`} aria-label={`Open dialer for ${contact.name}, ${contact.phone}`}><b>{contact.phone}</b><span>Open dialer ↗</span></a>
      </section>)}</div>
      {!data.directory.contacts.length && <p className="dispatch-warning">{data.directory.coverage_notice}</p>}
      {!compact && <><p className="dispatch-muted">{data.directory.coverage_notice}</p><div className="dispatch-ai-review">
        <strong>AI note review</strong>
        {aiBusy ? <p role="status">Reviewing the citizen note…</p> : ai ? <><p>{ai.notice}</p>{ai.signals.map(signal => <p key={signal.kind}><b>{SIGNALS[signal.kind] || 'Support need mentioned'}</b><br/>“{signal.evidence}”</p>)}</> : <p>{data.ai_available ? 'Extract support needs from the citizen note for admin review.' : 'Not configured. The saved incident brief and official contacts are available.'}</p>}
        {data.ai_available && <button type="button" disabled={aiBusy || !data.notes} onClick={() => void reviewNote(data)}>{ai ? 'Review note again' : 'Review note with AI'}</button>}
      </div><details className="dispatch-handoff"><summary>Dispatcher handoff</summary><p>{data.handoff}</p></details><button type="button" onClick={() => void copy()}>Copy handoff</button><span className="dispatch-copy-state" role="status">{copyState}</span></>}
      <footer>Admin review required · opening the dialer does not confirm contact or dispatch.</footer>
    </>}
  </article>;
}

export function DispatchNotifications({ onOpenIncident }: { onOpenIncident: (id: string) => void }) {
  const [items, setItems] = useState<DispatchItem[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [toast, setToast] = useState<DispatchItem | null>(null);
  const [retry, setRetry] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const announced = useRef(new Set<string>());
  const initialized = useRef(false);
  const inbox = useRef<HTMLElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const mutation = useRef(0);

  useEffect(() => {
    let active = true, busy = false;
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      const version = mutation.current;
      try {
        const result = await dispatchApi.list();
        if (!active || version !== mutation.current) return;
        setItems(result.items); setCount(result.unread_count); setError('');
        const unseen = result.items.filter(item => !item.reviewed && !announced.current.has(stamp(item)));
        announced.current = new Set(result.items.map(stamp));
        if (unseen.length) setToast(unseen[0]);
        else setToast(current => current && result.items.find(item => stamp(item) === stamp(current) && !item.reviewed) || null);
        initialized.current = true;
      } catch (err) { if (active) setError(message(err)); }
      finally { busy = false; }
    };
    void refresh(); const timer = window.setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [retry]);

  useEffect(() => {
    if (!open) return;
    inbox.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); bell.current?.focus(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open]);
  const selected = items.find(item => item.incident_id === focused);
  useEffect(() => {
    const openIncident = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setFocused(id); setOpen(true); setToast(null);
    };
    window.addEventListener('jalrakshak:open-dispatch', openIncident);
    return () => window.removeEventListener('jalrakshak:open-dispatch', openIncident);
  }, []);
  const review = async (item: DispatchItem) => {
    mutation.current++; setReviewError(''); setReviewing(true);
    try {
      await dispatchApi.review(item);
      setItems(current => current.map(row => stamp(row) === stamp(item) ? { ...row, reviewed: true } : row));
      setCount(current => Math.max(0, current - Number(!item.reviewed)));
      setToast(current => current && stamp(current) === stamp(item) ? null : current);
    } catch (err) { setReviewError(message(err)); }
    finally { mutation.current++; setReviewing(false); setRetry(n => n + 1); }
  };
  const show = (item?: DispatchItem) => { setFocused(item?.incident_id ?? items.find(row => !row.reviewed)?.incident_id ?? items[0]?.incident_id ?? null); setOpen(true); setToast(null); };
  return <>
    <button ref={bell} type="button" className={`dispatch-bell ${error ? 'offline' : ''}`} aria-label={`Dispatch notifications, ${count} unread`} aria-expanded={open} onClick={() => open ? setOpen(false) : show()}><Bell/><span>Dispatch alerts</span><b>{error ? '!' : count}</b></button>
    {createPortal(<div className="dispatch-ui dispatch-overlays">
      {toast && !open && <aside className="dispatch-toast" data-dispatch-toast><div role="status"><Bell/><strong>{initialized.current ? 'SOS needs review' : 'Incoming SOS'}</strong><span>{count} unread</span></div><button className="dispatch-dismiss" aria-label="Dismiss notification popup" onClick={() => setToast(null)}>×</button>
        <p><b>{toast.incident_id}</b> · {toast.title}</p>
        {error ? <p className="dispatch-warning">Feed unavailable; this report may have changed. Open the inbox to retry.</p> : <DispatchAssistantCard key={stamp(toast)} incidentId={toast.incident_id} changeKey={`${stamp(toast)}:${toast.latitude}:${toast.longitude}`} compact/>}
        <button type="button" className="dispatch-primary" onClick={() => show(toast)}>Review request & contacts</button>
      </aside>}
      {open && <aside ref={inbox} tabIndex={-1} className="dispatch-inbox" aria-label="Dispatch notification inbox" data-dispatch-inbox><header><div><span className="dispatch-eyebrow">LIVE REQUESTS</span><h2>Dispatch alerts <b>{count}</b></h2></div><button type="button" aria-label="Close dispatch notifications" onClick={() => { setOpen(false); bell.current?.focus(); }}>×</button></header>
        <p className="dispatch-muted">New and changed SOS requests · checks every 5 seconds while this app is visible.</p>
        {error && <div role="status" className="dispatch-warning">{error} Displayed requests may be outdated. <button onClick={() => setRetry(n => n + 1)}>Retry notifications</button></div>}
        {!items.length && !error && <p role="status">No active live requests. Demo incidents do not create alerts.</p>}
        <div className="dispatch-inbox-list">{items.map(item => <button type="button" key={item.incident_id} aria-pressed={focused === item.incident_id} className={item.reviewed ? 'reviewed' : ''} onClick={() => { setFocused(item.incident_id); setReviewError(''); }}><span>{item.reviewed ? '✓ Reviewed' : '● Needs review'} · {item.incident_id}</span><strong>{item.title}</strong><small>{item.people_count} {item.people_count === 1 ? 'person' : 'people'} · {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</small></button>)}</div>
        {selected && !error && <><div className="dispatch-inbox-actions"><button type="button" onClick={() => { onOpenIncident(selected.incident_id); setOpen(false); }}>Open incident</button><button type="button" disabled={reviewing || selected.reviewed} onClick={() => void review(selected)}>{selected.reviewed ? 'Reviewed by you' : reviewing ? 'Saving…' : 'Mark reviewed'}</button></div>{reviewError && <p role="status" className="dispatch-warning">{reviewError}</p>}<DispatchAssistantCard key={selected.incident_id} incidentId={selected.incident_id} changeKey={`${stamp(selected)}:${selected.latitude}:${selected.longitude}`} autoReview/></>}
      </aside>}
    </div>, document.body)}
  </>;
}

export function IncidentDispatchCard({ record }: { record: EmergencyRecord }) {
  if (record.is_demo) return <article className="dispatch-ui dispatch-assistant"><strong>Dispatch assistant</strong><p>Demo incident · no live contact recommendation.</p></article>;
  if (['resolved', 'cancelled'].includes(record.status)) return null;
  return <article className="dispatch-ui dispatch-assistant"><span className="dispatch-eyebrow">DISPATCH ASSISTANT</span><p>Review the {record.emergency_type} request, location-based emergency contacts and a dispatcher handoff.</p><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('jalrakshak:open-dispatch', { detail: record.id }))}>Open dispatch assistance</button></article>;
}
