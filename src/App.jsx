import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './components/Toast';
import { Alert, Hero, PillButton, Shell } from './components/ui';
import Login from './views/Login';
import SetPassword from './views/SetPassword';
import EmployeeDashboard from './views/EmployeeDashboard';
import CeoDashboard from './views/CeoDashboard';

function Gate() {
  const { session, employee, loading, profileError, signOut } = useAuth();

  if (loading) {
    return (
      <Shell>
        <section className="la-card">
          <div className="la-message" role="status">Loading…</div>
        </section>
      </Shell>
    );
  }

  if (!session) return <Login />;

  if (!employee) {
    return (
      <Shell onLogout={signOut}>
        <Hero />
        <section className="la-card">
          <Alert error>{profileError || 'Could not load your employee profile.'}</Alert>
          <div className="la-actions">
            <PillButton block onClick={signOut}>Log Out</PillButton>
          </div>
        </section>
      </Shell>
    );
  }

  return employee.role === 'ceo' ? <CeoDashboard /> : <EmployeeDashboard />;
}

export default function App() {
  // The invitation / password-reset link lands here; it needs the raw auth
  // session, not the employee profile, so it renders outside <AuthProvider>.
  if (window.location.pathname.replace(/\/+$/, '') === '/set-password') {
    return <SetPassword />;
  }

  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
