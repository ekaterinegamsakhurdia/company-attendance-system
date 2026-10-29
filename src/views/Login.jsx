import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { Alert, AuthLayout, SectionCard } from '../components/ui';
import { requestPasswordReset, signIn } from '../services/api';
import { navigate } from '../lib/route';

export default function Login() {
  const [mode, setMode] = useState('login'); // 'login' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        await requestPasswordReset(email.trim());
        // Same message whether or not the address exists.
        setNotice('If this email belongs to an account, a password reset link is on its way.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === 'login';

  return (
    <AuthLayout subtitle="Employee Attendance System" onBack={() => navigate('home')}>
      <SectionCard
        icon={LogIn}
        eyebrow={isLogin ? 'Sign in with your work email.' : 'We will email you a link to set a new password.'}
        title={isLogin ? 'Employee Login' : 'Reset Password'}
      >
        <form onSubmit={handleSubmit}>
          <label className="la-label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            className="la-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            autoComplete="username"
            required
          />

          {isLogin && (
            <>
              <label className="la-label" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                className="la-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </>
          )}

          <button type="submit" disabled={busy} className="la-btn primary block">
            {busy ? 'Please wait…' : isLogin ? 'Log In' : 'Send Reset Link'}
          </button>

          <div className="la-auth-links">
            <button
              type="button"
              className="la-link"
              onClick={() => {
                setMode(isLogin ? 'reset' : 'login');
                setError('');
                setNotice('');
              }}
            >
              {isLogin ? 'Forgot your password?' : 'Back to login'}
            </button>
          </div>
        </form>

        {error && <Alert error>{error}</Alert>}
        {notice && <Alert success>{notice}</Alert>}
      </SectionCard>
    </AuthLayout>
  );
}
