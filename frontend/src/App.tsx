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
      <AuthRedirectBridge />
      <Routes>
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
    </BrowserRouter>
  );
}
