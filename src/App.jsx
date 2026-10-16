import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './components/Toast';
import { Alert, Hero, Message, PillButton, Shell } from './components/ui';
import Login from './views/Login';
import SetPassword from './views/SetPassword';
import EmployeeDashboard from './views/EmployeeDashboard';
import CeoDashboard from './views/CeoDashboard';
import DeveloperDashboard from './views/DeveloperDashboard';
import { isPasswordLink } from './lib/authLink';

function Gate() {
  const { session, employee, loading, profileError, signOut } = useAuth();

  if (loading) {
    return (
      <Shell bare>
        <div className="la-auth">
          <section className="la-card">
            <Message>Loading…</Message>
          </section>
        </div>
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

  if (employee.role === 'developer') return <DeveloperDashboard />;
  return employee.role === 'ceo' ? <CeoDashboard /> : <EmployeeDashboard />;
}

export default function App() {
  // The invitation / password-reset link lands here; it needs the raw auth
  // session, not the employee profile, so it renders outside <AuthProvider>.
  // The same page is shown when the link landed on another path (for example when the
  // address is missing from Supabase's redirect list, it falls back to the site root).
  if (window.location.pathname.replace(/\/+$/, '') === '/set-password' || isPasswordLink()) {
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
