/**
 * Loads the demo-scenario flag from the server before rendering the app.
 * When demo mode is on, wraps every screen in a banner so synthetic data is never mistaken for live data.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../lib/api-client';
import './Scenario.css';
import { setScenarioState } from './scenario-state';

export type Point = { latitude: number; longitude: number };
export type Scenario = { enabled: boolean; title: string; notice: string; origin: Point | null; destination: Point | null; destination_name: string | null };
const live: Scenario = { enabled: false, title: 'Live data', notice: '', origin: null, destination: null, destination_name: null };
const Context = createContext<Scenario>(live);
export const useScenario = () => useContext(Context);

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // `active` ignores a response that arrives after unmount (avoids setting state on a dead component).
    let active = true;
    apiRequest<Scenario>('/mobile/scenario', { cache: 'no-store' })
      .then(value => { if (active) { setScenarioState(value); setScenario(value); setError(''); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Server unavailable'); });
    return () => { active = false; };
  }, [attempt]);
  // Block the whole app until the server answers, so demo mode is known before any screen renders.
  if (!scenario) return <main className="scenario-connection"><h1>WaySignal</h1><p>{error || 'Checking server connection…'}</p>{error && <button onClick={() => setAttempt(value => value + 1)}>Retry connection</button>}</main>;
  if (!scenario.enabled) return <Context.Provider value={scenario}>{children}</Context.Provider>;
  return <Context.Provider value={scenario}><div className={scenario.enabled ? 'scenario-layout' : undefined}>
    {scenario.enabled && <div className="scenario-banner" role="status"><strong>DEMO SCENARIO</strong><span>Synthetic conditions, routes and people · not a live emergency</span><Link to="/scenario">Open exercise →</Link></div>}
    <div className={scenario.enabled ? 'scenario-content' : undefined}>{children}</div>
  </div></Context.Provider>;
}
