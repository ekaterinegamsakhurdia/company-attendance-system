import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../services/supabase';
import { Alert, AuthLayout, SectionCard } from '../components/ui';
import { authLink } from '../lib/authLink';

const MIN_LENGTH = 8;

const friendly = (message) => {
  if (/same as the old|different from the old/i.test(message)) return 'Choose a password you have not used before.';
  if (/weak|easy to guess|pwned/i.test(message)) return 'That password is too easy to guess. Use a longer one with letters and numbers.';
  if (/expired|invalid/i.test(message)) return 'This link has expired or was already used.';
  return message;
};

export default function SetPassword() {
  // Invitation and reset links are for one person: keep this page out of search results.
  useEffect(() => {
    const previous = document.querySelector('meta[name="robots"]');
    const noindex = document.createElement('meta');
    noindex.name = 'robots';
    noindex.content = 'noindex, nofollow';
    previous?.remove();
    document.head.appendChild(noindex);
    return () => {
      noindex.remove();
      if (previous) document.head.appendChild(previous);
    };
  }, []);

  const [state, setState] = useState(authLink.tokenHash && !authLink.error ? 'confirm' : 'checking'); // confirm | checking | ready | invalid | done
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLink.error) {
      setError(friendly(authLink.error));
      setState('invalid');
      return undefined;
    }
    // A "confirm" link waits for a click (see confirmLink), so mail scanners cannot use it up.
    if (authLink.tokenHash) return undefined;

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

  async function confirmLink() {
    setError('');
    setSaving(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: authLink.tokenHash,
      type: authLink.type === 'recovery' ? 'recovery' : 'invite',
    });
    setSaving(false);
    if (verifyError) {
      setError(friendly(verifyError.message));
      setState('invalid');
      return;
    }
    window.history.replaceState(null, '', '/set-password');
    setState('ready');
  }

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
      setError(friendly(updateError.message));
      return;
    }
    setState('done');
    setTimeout(() => window.location.replace('/'), 1500);
  }

  return (
    <AuthLayout subtitle="Employee Attendance System">

      {state === 'checking' && (
        <section className="la-card">
          <div className="la-message" role="status">
            Checking your link…
          </div>
        </section>
      )}

      {state === 'confirm' && (
        <SectionCard icon={KeyRound} title={authLink.type === 'recovery' ? 'Reset your password' : 'Welcome'}>
          <p className="la-hint">
            {authLink.type === 'recovery' ? 'Press the button to choose a new password.' : 'Press the button to create your password and finish setting up your account.'}
          </p>
          {error && <Alert error>{error}</Alert>}
          <button type="button" className="la-btn primary block" onClick={confirmLink} disabled={saving}>
            {saving ? 'Please wait…' : 'Continue'}
          </button>
        </SectionCard>
      )}

      {state === 'invalid' && (
        <SectionCard icon={KeyRound} title="Link problem">
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
        <SectionCard icon={KeyRound} title="Create Your Password">
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
        <SectionCard icon={KeyRound} title="All set">
          <Alert success>Your password has been saved. Taking you to the app…</Alert>
        </SectionCard>
      )}
    </AuthLayout>
  );
}
