import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../services/supabase';
import { Alert, Hero, SectionCard, Shell } from '../components/ui';

const MIN_LENGTH = 8;

// Supabase reports an expired/used link in the URL hash, e.g. #error_description=...
function linkErrorFromUrl() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get('error_description')?.replaceAll('+', ' ') ?? '';
}

export default function SetPassword() {
  const [state, setState] = useState('checking'); // checking | ready | invalid | done
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const urlError = linkErrorFromUrl();
    if (urlError) {
      setError(urlError);
      setState('invalid');
      return undefined;
    }

    let active = true;
    // getSession() waits for the invite/recovery token in the URL to be processed.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState(data.session ? 'ready' : 'invalid');
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && active) setState((s) => (s === 'done' ? s : 'ready'));
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters long.`);
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setState('done');
    setTimeout(() => window.location.replace('/'), 1500);
  }

  return (
    <Shell>
      <Hero subtitle="Employee Attendance System" />

      {state === 'checking' && (
        <section className="la-card">
          <div className="la-message" role="status">
            Checking your link…
          </div>
        </section>
      )}

      {state === 'invalid' && (
        <SectionCard icon={KeyRound} eyebrow="Account setup" title="Link problem">
          <Alert error>
            {error || 'This link is invalid or has expired.'} Please ask your CEO to send a new invitation, or use
            "Forgot your password?" on the login page.
          </Alert>
          <button type="button" className="la-btn primary block" onClick={() => window.location.replace('/')}>
            Go to Login
          </button>
        </SectionCard>
      )}

      {state === 'ready' && (
        <SectionCard icon={KeyRound} eyebrow="Account setup" title="Create Your Password">
          <form onSubmit={handleSubmit}>
            <label className="la-label" htmlFor="new-password">
              New Password
            </label>
            <input
              id="new-password"
              type="password"
              className="la-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={saving}
              required
            />
            <label className="la-label" htmlFor="confirm-password">
              Confirm Password
            </label>
            <input
              id="confirm-password"
              type="password"
              className="la-input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={saving}
              required
            />
            <p className="la-hint">At least {MIN_LENGTH} characters.</p>
            <button type="submit" className="la-btn primary block" disabled={saving}>
              {saving ? 'Saving…' : 'Save Password'}
            </button>
          </form>
          {error && <Alert error>{error}</Alert>}
        </SectionCard>
      )}

      {state === 'done' && (
        <SectionCard icon={KeyRound} eyebrow="Account setup" title="All set">
          <Alert success>Your password has been saved. Taking you to the app…</Alert>
        </SectionCard>
      )}
    </Shell>
  );
}
