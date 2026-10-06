import { useEffect, useState } from 'react';
import { supabase } from './services/supabase';

export default function SetPassword() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    checkInvitationSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      console.log('SET PASSWORD - AUTH EVENT:', _event);
      console.log('SET PASSWORD - SESSION:', currentSession);

      if (currentSession) {
        setSession(currentSession);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function checkInvitationSession() {
    console.log('SET PASSWORD - STEP 1: Checking session...');

    setLoading(true);
    setError('');

    const {
      data: { session: currentSession },
      error: sessionError,
    } = await supabase.auth.getSession();

    console.log('SET PASSWORD - SESSION RESULT:', currentSession);
    console.log('SET PASSWORD - SESSION ERROR:', sessionError);

    if (sessionError) {
      setError(sessionError.message);
      setLoading(false);
      return;
    }

    if (!currentSession) {
      setError(
        'This invitation link is invalid or has expired. Please ask your CEO to send you a new invitation.'
      );
      setLoading(false);
      return;
    }

    setSession(currentSession);
    setLoading(false);

    console.log('SET PASSWORD - STEP 1 SUCCESS');
  }

  async function handleSetPassword(event) {
    event.preventDefault();

    setError('');
    setMessage('');

    if (!password || !confirmPassword) {
      setError('Please enter your password in both fields.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setSaving(true);

    console.log('SET PASSWORD - STEP 2: Updating password...');

    const { data, error: updateError } = await supabase.auth.updateUser({
      password,
    });

    console.log('SET PASSWORD - UPDATE RESULT:', data);
    console.log('SET PASSWORD - UPDATE ERROR:', updateError);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    console.log('SET PASSWORD - STEP 2 SUCCESS');

    setMessage(
      'Your password has been created successfully. You can now log in.'
    );

    setPassword('');
    setConfirmPassword('');
    setSaving(false);

    setTimeout(async () => {
      await supabase.auth.signOut();
      window.location.href = '/';
    }, 2000);
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>Looper Agency</h1>
          <p style={styles.subtitle}>Setting up your account...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>Looper Agency</h1>

          <h2 style={styles.heading}>Invitation Problem</h2>

          <p style={styles.error}>
            {error ||
              'This invitation link is invalid or has expired.'}
          </p>

          <button
            onClick={() => {
              window.location.href = '/';
            }}
            style={styles.button}
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Looper Agency</h1>

        <h2 style={styles.heading}>Create Your Password</h2>

        <p style={styles.subtitle}>
          Welcome! Please create a password for your employee account.
        </p>

        <form onSubmit={handleSetPassword}>
          <label style={styles.label}>New Password</label>

          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="new-password"
            style={styles.input}
            disabled={saving}
          />

          <label style={styles.label}>Confirm Password</label>

          <input
            type="password"
            value={confirmPassword}
            onChange={(event) =>
              setConfirmPassword(event.target.value)
            }
            placeholder="Enter your password again"
            autoComplete="new-password"
            style={styles.input}
            disabled={saving}
          />

          <p style={styles.requirement}>
            Password must be at least 6 characters.
          </p>

          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}

          {message && (
            <div style={styles.successBox}>
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            style={{
              ...styles.button,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Creating Password...' : 'Create Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f7fa',
    padding: '20px',
    boxSizing: 'border-box',
  },

  card: {
    width: '100%',
    maxWidth: '450px',
    background: '#ffffff',
    padding: '40px',
    borderRadius: '12px',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)',
    boxSizing: 'border-box',
  },

  title: {
    margin: '0 0 8px',
    textAlign: 'center',
    fontSize: '28px',
    color: '#111827',
  },

  heading: {
    margin: '25px 0 10px',
    textAlign: 'center',
    fontSize: '22px',
    color: '#111827',
  },

  subtitle: {
    margin: '0 0 25px',
    textAlign: 'center',
    color: '#6b7280',
    lineHeight: 1.5,
  },

  label: {
    display: 'block',
    marginBottom: '7px',
    marginTop: '18px',
    fontWeight: '600',
    color: '#374151',
  },

  input: {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #d1d5db',
    borderRadius: '7px',
    fontSize: '16px',
    boxSizing: 'border-box',
    outline: 'none',
  },

  requirement: {
    fontSize: '13px',
    color: '#6b7280',
    marginTop: '8px',
  },

  button: {
    width: '100%',
    marginTop: '22px',
    padding: '13px',
    border: 'none',
    borderRadius: '7px',
    background: '#111827',
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
  },

  error: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '12px',
    borderRadius: '7px',
    lineHeight: 1.5,
  },

  errorBox: {
    marginTop: '15px',
    background: '#fee2e2',
    color: '#991b1b',
    padding: '12px',
    borderRadius: '7px',
    lineHeight: 1.5,
  },

  successBox: {
    marginTop: '15px',
    background: '#dcfce7',
    color: '#166534',
    padding: '12px',
    borderRadius: '7px',
    lineHeight: 1.5,
  },
};
