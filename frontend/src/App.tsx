/**
 * Top-level routing. Login lives at "/", citizens at "/citizen", responders (role "worker")
 * at "/responder". ScenarioProvider wraps everything so every screen knows if demo mode is on.
 */
import { useEffect, type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import LoginPage from './features/auth/pages/LoginPage';
import { authSession } from './features/auth/auth-session';
import type { LoginResponse } from './features/auth/types/auth.types';
import CitizenDashboard from './features/dashboard/pages/CitizenDashboard';
import WorkerDashboard from './features/dashboard/pages/WorkerDashboard';
import { ScenarioProvider } from './features/scenario/ScenarioContext';
import ScenarioPage from './features/scenario/ScenarioPage';

// LoginPage announces success with a window event instead of taking a callback prop;
// this invisible component turns that event into a stored session + role-based redirect.
function AuthRedirectBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const onAuthenticated = (event: Event) => {
      const authEvent = event as CustomEvent<LoginResponse>;
      const session = authEvent.detail;
      if (!session?.user) return;

      authSession.set(session);
      navigate(session.user.role === 'worker' ? '/responder' : '/citizen', {
        replace: true,
      });
    };

    window.addEventListener('g0ne:authenticated', onAuthenticated);
    return () => window.removeEventListener('g0ne:authenticated', onAuthenticated);
  }, [navigate]);

  return null;
}

// Client-side guard only: it controls what's shown, but the backend must still enforce roles
// on every API call, because anyone can change front-end state.
function ProtectedRoute({ role, children }: { role: 'citizen' | 'worker'; children: ReactNode }) {
  const session = authSession.get();

  if (!session) return <Navigate to="/" replace />;
  if (session.user.role !== role) {
    return <Navigate to={session.user.role === 'worker' ? '/responder' : '/citizen'} replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScenarioProvider>
      <AuthRedirectBridge />
      <Routes>
        <Route path="/scenario" element={<ScenarioPage />} />
        <Route path="/" element={<LoginPage />} />
        <Route
          path="/citizen"
          element={
            <ProtectedRoute role="citizen">
              <CitizenDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/responder"
          element={
            <ProtectedRoute role="worker">
              <WorkerDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/admin" element={<Navigate to="/responder" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ScenarioProvider>
    </BrowserRouter>
  );
}
