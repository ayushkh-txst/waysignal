// Server-confirmed scenario state for inherited non-React adapters.
import type { Scenario } from './ScenarioContext';
let current: Scenario | null = null;
export const setScenarioState = (scenario: Scenario) => { current = scenario; };
export const isDemoScenario = () => current?.enabled === true;
export const demoOrigin = () => current?.enabled ? current.origin : null;
