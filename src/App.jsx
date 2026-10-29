import { lazy, Suspense, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './components/Toast';
import { Alert, Hero, PillButton, Shell } from './components/ui';
import LoopLoader from './components/LoopLoader';
import Login from './views/Login';
import SetPassword from './views/SetPassword';
import { isPasswordLink } from './lib/authLink';
import { replaceRoute } from './lib/route';
import { useRoute } from './hooks/useRoute';

// Each page is its own chunk: the sign-in visit downloads only the landing page, and a signed-in person
// downloads only the dashboard that belongs to their role.
const Landing = lazy(() => import('./views/Landing'));
const EmployeeDashboard = lazy(() => import('./views/EmployeeDashboard'));
const CeoDashboard = lazy(() => import('./views/CeoDashboard'));
const DeveloperDashboard = lazy(() => import('./views/DeveloperDashboard'));

function Gate() {
  const { session, employee, loading, profileError, signOut } = useAuth();
  const route = useRoute();
  const hadSession = useRef(false);

  // Signing in leaves the "#login" address behind; signing out lands on the sign-in page.
  useEffect(() => {
    if (loading) return;
    if (session) {
      hadSession.current = true;
      if (window.location.hash === '#login') replaceRoute('home');
    } else if (hadSession.current) {
      hadSession.current = false;
      replaceRoute('login');
    }
  }, [session, loading]);

  if (loading) return <LoopLoader />;

  if (!session) return route === 'login' ? <Login /> : <Landing />;

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
        <Suspense fallback={<LoopLoader />}>
          <Gate />
        </Suspense>
      </AuthProvider>
    </ToastProvider>
  );
}
