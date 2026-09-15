import { FormEvent, useState } from 'react';
import { authApi } from '../api/auth.api';
import { ApiError } from '../../../lib/api-client';

// Public sample accounts from backend/app/core/config.py. Vite removes these
// credentials from production builds; autofill only runs on loopback hosts.
const DEMO_ACCOUNTS = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  ? [
      { email: 'citizen@example.com', password: 'CitizenDemo2026!' },
      { email: 'worker@example.com', password: 'WorkerDemo2026!' },
    ]
  : [];

function demoAccount(email: string) {
  return DEMO_ACCOUNTS.find((account) => account.email === email.trim().toLowerCase());
}

const ShieldMark = ({ large = false }: { large?: boolean }) => (
  <svg className={large ? 'shield-mark shield-mark--large' : 'shield-mark'} viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 5 51 12v15c0 13.4-7.8 24.8-19 31C20.8 51.8 13 40.4 13 27V12L32 5Z" fill="none" stroke="currentColor" strokeWidth="3"/>
    <path d="M21 31c4.5 0 7.4-2.1 9.3-6.4 2.7 4.8 6.5 7.2 11.7 7.2 2.1 0 4.1-.4 6-1.2-2.1 8.8-7.7 15.8-16 20-6.2-3.2-11-8.6-13.4-15.3 1 .2 1.8.3 2.4.3Z" fill="currentColor" opacity=".84"/>
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m5 7 7 5 7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10" width="13" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M8.5 10V7.8a3.5 3.5 0 0 1 7 0V10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
);

const EyeIcon = ({ hidden }: { hidden: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" fill="none" stroke="currentColor" strokeWidth="1.6"/><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6"/>{hidden && <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>}</svg>
);

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.52h3.22c1.89-1.74 2.99-4.3 2.99-7.37Z"/>
    <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.4l-3.22-2.52c-.9.6-2.04.96-3.39.96-2.6 0-4.81-1.76-5.6-4.13H3.08v2.6A10 10 0 0 0 12 22Z"/>
    <path fill="#FBBC05" d="M6.4 13.91A6.02 6.02 0 0 1 6.09 12c0-.66.11-1.3.31-1.91v-2.6H3.08A10 10 0 0 0 2 12c0 1.61.39 3.13 1.08 4.51l3.32-2.6Z"/>
    <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.92 5.49l3.32 2.6c.79-2.37 3-4.13 5.6-4.13Z"/>
  </svg>
);

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.66.35-1.11.64-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.72 0 0 .84-.28 2.75 1.05A9.25 9.25 0 0 1 12 6.93c.85 0 1.7.12 2.5.37 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.46.1 2.72.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"/></svg>
);

const SceneArt = () => (
  <svg className="scene-art" viewBox="0 0 1200 210" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 125C95 76 168 134 263 112c89-21 125-68 221-38 80 25 126 54 202 30 100-32 128-66 235-23 95 38 159 11 279-18v147H0Z" fill="#dfcfb3"/>
    <path d="M0 152c108-46 192 8 292 0 91-8 144-50 234-24 94 28 138 50 234 30 115-25 207-56 440-16v68H0Z" fill="#cfb995"/>
    <path d="M0 177c109-14 194-3 289 4 96 8 185 15 278-4 103-21 177 5 273 4 109-1 229-29 360-15v44H0Z" fill="#bda37c"/>
    <path d="M0 193c187-7 284 7 434 9 182 2 280-12 412-4 146 8 219-6 354-5v17H0Z" fill="#aa8f67"/>
    <g fill="#9b815d">
      <rect x="38" y="164" width="5" height="30" rx="2"/><circle cx="40.5" cy="157" r="16"/>
      <rect x="83" y="170" width="5" height="24" rx="2"/><circle cx="85.5" cy="162" r="12"/>
      <rect x="126" y="164" width="5" height="30" rx="2"/><circle cx="128.5" cy="156" r="15"/>
      <rect x="1090" y="163" width="5" height="31" rx="2"/><circle cx="1092.5" cy="155" r="15"/>
      <rect x="1138" y="169" width="5" height="25" rx="2"/><circle cx="1140.5" cy="162" r="12"/>
    </g>
    <g stroke="#816947" strokeWidth="3" fill="none" strokeLinecap="round">
      <path d="M458 190c18-13 41-18 64-16 19 2 35 9 48 19"/>
      <path d="M476 194v11M553 194v11"/>
      <path d="M478 183h76"/>
      <path d="M731 115c4-4 8-4 12 0M751 120c4-4 8-4 12 0" strokeWidth="2"/>
    </g>
    <g fill="#816947">
      <rect x="575" y="165" width="7" height="29"/><path d="m578 165 10-7-10-2Z"/>
      <rect x="596" y="169" width="7" height="25"/><path d="m599 169 10-7-10-2Z"/>
    </g>
  </svg>
);

function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [initialEmail] = useState(() => localStorage.getItem('g0ne:remembered-email') || DEMO_ACCOUNTS[0]?.email || '');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(() => demoAccount(initialEmail)?.password ?? '');
  const [rememberMe, setRememberMe] = useState(Boolean(localStorage.getItem('g0ne:remembered-email')));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const changeEmail = (value: string) => {
    const account = demoAccount(value);
    if (account || demoAccount(email)) setPassword(account?.password ?? '');
    setEmail(value);
    setShowPassword(false);
    setError(null);
    setSuccess(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!validateEmail(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authApi.login({ email: normalizedEmail, password });

      if (rememberMe) localStorage.setItem('g0ne:remembered-email', normalizedEmail);
      else localStorage.removeItem('g0ne:remembered-email');

      setPassword('');
      setSuccess(`Signed in as ${result.user.name}. Preparing your ${result.user.role === 'worker' ? 'E-worker' : 'citizen'} workspace…`);

      // Keep the access token out of localStorage/sessionStorage. A shared auth provider
      // will own it once the dashboard shell is connected.
      window.dispatchEvent(new CustomEvent('g0ne:authenticated', { detail: result }));
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 401 || cause.status === 403) setError('Email or password is incorrect.');
        else if (cause.status === 408) setError('The server is taking too long to respond. Try again.');
        else if (cause.status === 0) setError('Authentication service is unavailable. Make sure the backend is running.');
        else setError('We could not sign you in. Please try again.');
      } else {
        setError('We could not sign you in. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="hero-panel">
        <header className="brand-row">
          <div className="brand"><span className="brand-mark"><ShieldMark /></span><span>G-One</span></div>
          <button className="language" type="button" aria-label="Change language"><span className="globe">◎</span> English <span className="chevron">⌄</span></button>
        </header>

        <div className="hero-content">
          <p className="eyebrow"><span className="eyebrow-dot"/>AI-POWERED FLOOD INTELLIGENCE</p>
          <h1>Safer<br/>Communities<br/><span>Stronger<br/>Tomorrows.</span></h1>
          <p className="hero-description">Real-time risk mapping, intelligent evacuation guidance, and emergency coordination for communities affected by floods.</p>
          <div className="benefits">
            <span><b>⌖</b> Real-time Alerts</span>
            <span><b>♙</b> Faster Response</span>
            <span><b>♢</b> Safer Communities</span>
          </div>
        </div>

        <div className="hero-watermark"><ShieldMark large /></div>
        <SceneArt />
      </section>

      <section className="form-panel">
        <div className="form-wrap">
          <h2>Welcome Back</h2>
          <p className="subtitle">Sign in to continue to G-One</p>

          <form onSubmit={submit} noValidate>
            <label className="field">
              <span className="field-icon"><MailIcon /></span>
              <input type="email" value={email} onChange={(event) => changeEmail(event.target.value)} placeholder="Email address" autoComplete="email" aria-label="Email address" disabled={isSubmitting} required />
            </label>
            <label className="field">
              <span className="field-icon"><LockIcon /></span>
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="current-password" aria-label="Password" disabled={isSubmitting} required/>
              <button className="field-action" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)} disabled={isSubmitting}><EyeIcon hidden={showPassword} /></button>
            </label>

            <div className="form-options">
              <label className="remember"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} disabled={isSubmitting}/> <span>Remember me</span></label>
              <button type="button" className="link-button" disabled={isSubmitting}>Forgot password?</button>
            </div>

            {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
            {success && <div className="auth-message auth-message--success" role="status">{success}</div>}

            <button className="sign-in" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <><span className="spinner" aria-hidden="true"/> Signing in…</> : <>Sign in <span>→</span></>}
            </button>
          </form>

          <div className="divider"><span/><small>or continue with</small><span/></div>
          <div className="socials">
            <button type="button" className="google" disabled={isSubmitting}><span className="social-icon"><GoogleIcon /></span><span>Continue with<br/>Google</span></button>
            <button type="button" className="github" disabled={isSubmitting}><span className="social-icon"><GitHubIcon /></span><span>Continue with<br/>GitHub</span></button>
          </div>
          <p className="contact">Don't have an account? <strong>Contact your administrator</strong></p>
        </div>
      </section>
    </main>
  );
}
