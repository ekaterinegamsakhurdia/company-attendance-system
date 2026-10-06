import { useEffect, useState } from 'react';
import {
  Layers,
  User,
  Hash,
  BadgeCheck,
  CalendarDays,
  LogIn,
  LogOut,
  Timer,
  Users,
  UserPlus,
  UserCheck,
  ListChecks,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { supabase } from './services/supabase';
import SetPassword from './SetPassword';

/* =========================================================
 * LOOPER AGENCY DESIGN SYSTEM (plain CSS, tokens on :root)
 * ======================================================= */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Georgian:wght@400;600;700;800&display=swap');

:root {
  --bg-page: #050B18;
  --bg-hero-glow: #0A1F4D;
  --bg-card: #0A1426;
  --bg-card-inner: #0D1930;
  --border: rgba(120,160,255,0.12);
  --border-strong: rgba(120,160,255,0.25);
  --primary: #2F8CFF;
  --primary-deep: #1A5CFF;
  --primary-soft: rgba(47,140,255,0.14);
  --text-heading: #FFFFFF;
  --text-body: #A9B6CC;
  --text-muted: #6F7E99;
  --grad-primary: linear-gradient(135deg, #3B9BFF, #1A5CFF);
  --grad-hero: radial-gradient(ellipse at 70% 40%, #0A1F4D 0%, #050B18 70%);
  --font: "Noto Sans Georgian", Inter, system-ui, sans-serif;
}

.la-page {
  min-height: 100vh;
  background: var(--grad-hero) no-repeat, var(--bg-page);
  background-attachment: fixed;
  color: var(--text-body);
  font-family: var(--font);
  font-size: 14px;
  line-height: 1.6;
  box-sizing: border-box;
}
.la-page *, .la-page *::before, .la-page *::after { box-sizing: border-box; }
.la-page h1, .la-page h2, .la-page h3 { color: var(--text-heading); margin: 0; font-family: var(--font); }
.la-page p { margin: 0; }
.la-page strong { color: var(--text-heading); font-weight: 600; }

/* Nav */
.la-nav {
  position: sticky; top: 0; z-index: 20;
  background: rgba(5,11,24,0.7);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
}
.la-nav-inner {
  max-width: 1100px; margin: 0 auto; padding: 12px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.la-brand { display: flex; align-items: center; gap: 10px; color: var(--text-heading); font-weight: 700; font-size: 15px; }

/* Layout */
.la-main { max-width: 700px; margin: 0 auto; padding: 32px 24px 56px; display: flex; flex-direction: column; gap: 24px; }
.la-main.wide { max-width: 1100px; }

/* Hero */
.la-hero { padding: 16px 0 8px; display: flex; flex-direction: column; gap: 14px; }
.la-badge {
  align-self: flex-start;
  background: var(--primary-soft); color: var(--primary);
  border: 1px solid var(--border-strong); border-radius: 999px;
  padding: 4px 12px; font-size: 11px; font-weight: 600;
}
.la-h1 { font-size: clamp(32px, 6vw, 44px); font-weight: 800; line-height: 1.1; }
.la-h1 span { color: var(--primary); }

/* Cards */
.la-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 20px; padding: 24px;
  transition: border-color 180ms ease;
}
.la-card:hover { border-color: var(--border-strong); }
@media (min-width: 768px) { .la-card { padding: 32px; } }
.la-card-head { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
.la-card-head.split { justify-content: space-between; flex-wrap: wrap; }
.la-card-head-left { display: flex; align-items: center; gap: 14px; }
.la-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--primary); }
.la-h2 { font-size: 21px; font-weight: 700; line-height: 1.25; }
.la-icon-tile {
  width: 40px; height: 40px; flex: none; border-radius: 10px;
  background: var(--grad-primary); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
}
.la-body { display: flex; flex-direction: column; gap: 16px; }
.la-meta { font-size: 12px; color: var(--text-muted); }

/* Nested tiles */
.la-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 640px) { .la-grid { grid-template-columns: repeat(2, 1fr); } }
.la-grid.stats { grid-template-columns: repeat(2, 1fr); }
@media (min-width: 900px) { .la-grid.stats { grid-template-columns: repeat(4, 1fr); } }
.la-tile {
  background: var(--bg-card-inner); border: 1px solid var(--border);
  border-radius: 12px; padding: 16px;
  display: flex; align-items: center; gap: 12px;
  transition: border-color 180ms ease;
}
.la-tile:hover { border-color: var(--border-strong); }
.la-tile-icon {
  width: 32px; height: 32px; flex: none; border-radius: 8px;
  background: var(--primary-soft); color: var(--primary);
  display: inline-flex; align-items: center; justify-content: center;
}
.la-tile-text { min-width: 0; word-break: break-word; }
.la-stat { flex-direction: column; align-items: flex-start; gap: 4px; }
.la-stat-num { font-size: 28px; font-weight: 800; color: var(--text-heading); line-height: 1.1; }
.la-stat-label { font-size: 12px; color: var(--text-muted); }

/* Buttons */
.la-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border-radius: 999px; padding: 10px 20px;
  font-family: var(--font); font-size: 14px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent;
  transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease, background 150ms ease;
}
.la-btn:hover:not(:disabled) { transform: translateY(-1px); }
.la-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.la-btn.block { width: 100%; }
.la-btn.sm { padding: 7px 14px; font-size: 13px; }
.la-btn.primary { background: var(--grad-primary); color: #fff; box-shadow: 0 0 24px rgba(47,140,255,.35); }
.la-btn.primary:hover:not(:disabled) { box-shadow: 0 0 32px rgba(47,140,255,.55); }
.la-btn.secondary { background: transparent; color: #fff; border-color: var(--border-strong); }
.la-btn.secondary:hover:not(:disabled) { border-color: var(--primary); background: var(--primary-soft); }
.la-page :focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

/* Forms */
.la-label { display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-heading); font-size: 13px; }
.la-input {
  width: 100%; padding: 12px 14px; margin-bottom: 20px;
  background: var(--bg-card-inner); color: var(--text-heading);
  border: 1px solid var(--border); border-radius: 12px;
  font-family: var(--font); font-size: 16px;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.la-input::placeholder { color: var(--text-muted); }
.la-input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.la-form-panel {
  background: var(--bg-card-inner); border: 1px solid var(--border);
  border-radius: 12px; padding: 20px; margin-bottom: 20px;
}
.la-form-panel h3 { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
.la-form-panel .la-input { background: var(--bg-card); }

/* Alerts */
.la-alert {
  display: flex; gap: 10px; align-items: flex-start;
  margin-top: 16px; padding: 12px 14px; border-radius: 12px;
  background: var(--primary-soft); border: 1px solid var(--border-strong);
  color: var(--text-heading); white-space: pre-wrap; font-size: 13px;
}
.la-alert svg { flex: none; margin-top: 2px; color: var(--primary); }
.la-alert.success { justify-content: center; align-items: center; text-align: center; }
.la-alert.success svg { margin-top: 0; }

/* Tables */
.la-table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-card-inner); }
.la-table { width: 100%; min-width: 520px; border-collapse: collapse; }
.la-th, .la-td { padding: 12px 14px; text-align: left; white-space: nowrap; font-size: 13px; border-bottom: 1px solid var(--border); }
.la-th { color: var(--text-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; background: rgba(120,160,255,0.04); }
.la-td { color: var(--text-body); }
.la-table tbody tr:last-child .la-td { border-bottom: none; }
.la-table tbody tr:hover .la-td { background: rgba(47,140,255,0.05); }
.la-protected { color: var(--text-muted); font-size: 12px; font-weight: 600; }
.la-message { background: var(--bg-card-inner); border: 1px solid var(--border); border-radius: 12px; padding: 18px; text-align: center; color: var(--text-muted); }
.la-stack { display: flex; flex-direction: column; gap: 16px; }
.la-actions { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; }

@media (prefers-reduced-motion: reduce) {
  .la-page * { transition: none !important; }
  .la-btn:hover:not(:disabled) { transform: none; }
}
`;

/* =========================================================
 * REUSABLE COMPONENTS
 * ======================================================= */

function Eyebrow({ children }) {
  return <div className="la-eyebrow">{children}</div>;
}

function IconTile({ icon: Icon }) {
  return (
    <span className="la-icon-tile" aria-hidden="true">
      <Icon size={20} />
    </span>
  );
}

function PillButton({
  variant = 'primary',
  size,
  block,
  icon: Icon,
  children,
  className = '',
  ...rest
}) {
  return (
    <button
      type="button"
      className={`la-btn ${variant}${size ? ` ${size}` : ''}${block ? ' block' : ''} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

function SectionCard({ icon, eyebrow, title, action, children }) {
  return (
    <section className="la-card">
      <div className={`la-card-head${action ? ' split' : ''}`}>
        <div className="la-card-head-left">
          {icon && <IconTile icon={icon} />}
          <div>
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            <h2 className="la-h2">{title}</h2>
          </div>
        </div>
        {action}
      </div>
      <div className="la-body">{children}</div>
    </section>
  );
}

function FeatureTile({ icon: Icon, children }) {
  return (
    <div className="la-tile">
      <span className="la-tile-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="la-tile-text">{children}</div>
    </div>
  );
}

function StatTile({ value, label }) {
  return (
    <div className="la-tile la-stat">
      <strong className="la-stat-num">{value}</strong>
      <span className="la-stat-label">{label}</span>
    </div>
  );
}

function Alert({ children, success }) {
  const Icon = success ? CheckCircle2 : AlertCircle;
  return (
    <div className={`la-alert${success ? ' success' : ''}`} role={success ? 'status' : 'alert'}>
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function DataTable({ headers, minWidth, children }) {
  return (
    <div className="la-table-wrap">
      <table className="la-table" style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="la-th" scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Shell({ children, wide, onLogout }) {
  return (
    <div className="la-page">
      <style>{css}</style>
      <header className="la-nav">
        <div className="la-nav-inner">
          <div className="la-brand">
            <IconTile icon={Layers} />
            <span>Looper Agency</span>
          </div>
          {onLogout && (
            <PillButton size="sm" icon={LogOut} onClick={onLogout}>
              Log Out
            </PillButton>
          )}
        </div>
      </header>
      <main className={`la-main${wide ? ' wide' : ''}`}>{children}</main>
    </div>
  );
}

function Hero({ eyebrow, subtitle }) {
  return (
    <div className="la-hero">
      {eyebrow && <span className="la-badge">{eyebrow}</span>}
      <h1 className="la-h1">
        Looper <span>Agency</span>
      </h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

/* =========================================================
 * APP
 * ======================================================= */

function App() {
  console.log("🔥🔥🔥 NEW APP.JSX LOADED 🔥🔥🔥");
  const [session, setSession] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [attendance, setAttendance] = useState(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [error, setError] = useState('');

  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // CEO dashboard
  const [ceoEmployees, setCeoEmployees] = useState([]);
  const [ceoAttendance, setCeoAttendance] = useState([]);
  const [ceoLoading, setCeoLoading] = useState(false);

  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmployeeNumber, setNewEmployeeNumber] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [addingEmployee, setAddingEmployee] = useState(false);
  const [deletingEmployeeId, setDeletingEmployeeId] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        setSession(session);

        if (session?.user) {
          await loadEmployee(session.user.id);
        }
      } catch (err) {
        console.error('INITIALIZATION ERROR:', err);
        setError(err.message || String(err));
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);

      if (session?.user) {
        await loadEmployee(session.user.id);
      } else {
        setEmployee(null);
        setAttendance(null);
        setAttendanceHistory([]);
        setCeoEmployees([]);
        setCeoAttendance([]);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function loadEmployee(authUserId) {
    setError('');

    const { data, error } = await supabase
      .from('employees')
      .select(`
        id,
        auth_user_id,
        employee_number,
        first_name,
        last_name,
        email,
        role,
        is_active,
        department_id
      `)
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (error) {
      console.error('EMPLOYEE ERROR:', error);
      setError(error.message);
      return;
    }

    if (!data) {
      setError('Your account is not linked to an employee record.');
      return;
    }

    if (!data.is_active) {
      setError('Your employee account is inactive.');
      return;
    }

    setEmployee(data);

    if (data.role === 'ceo') {
      // The CEO is also an employee record, so load their own attendance.
      await loadAttendanceHistory(data.id);
      await loadTodayAttendance(data.id);
      await loadCeoDashboard();
    } else {
      await loadAttendanceHistory(data.id);
      await loadTodayAttendance(data.id);
    }
  }

  async function loadCeoDashboard() {
    setCeoLoading(true);
    setError('');

    try {
      const { data: employees, error: employeesError } =
        await supabase
          .from('employees')
          .select(`
            id,
            auth_user_id,
            employee_number,
            first_name,
            last_name,
            email,
            role,
            is_active,
            department_id
          `)
          .order('employee_number', { ascending: true });

      if (employeesError) {
        console.error('CEO EMPLOYEES ERROR:', employeesError);
        setError(employeesError.message);
        return;
      }

      const today = getTodayDate();

      const {
        data: attendanceData,
        error: attendanceError,
      } = await supabase
        .from('attendance')
        .select(`
          id,
          employee_id,
          work_date,
          clock_in,
          clock_out,
          clockout_type,
          worked_minutes
        `)
        .eq('work_date', today);

      if (attendanceError) {
        console.error('CEO ATTENDANCE ERROR:', attendanceError);
        setError(attendanceError.message);
        return;
      }

      setCeoEmployees(employees || []);
      setCeoAttendance(attendanceData || []);
    } catch (err) {
      console.error('CEO DASHBOARD ERROR:', err);
      setError(err.message || String(err));
    } finally {
      setCeoLoading(false);
    }
  }

  async function handleAddEmployee(event) {
    if (event) {
      event.preventDefault();
    }

    if (!newEmployeeNumber.trim()) {
      setError('Employee number is required.');
      return;
    }

    if (!newFirstName.trim()) {
      setError('First name is required.');
      return;
    }

    if (!newLastName.trim()) {
      setError('Last name is required.');
      return;
    }

    if (!newEmail.trim()) {
      setError('Email is required.');
      return;
    }

    setAddingEmployee(true);
    setError('');

    try {
      // =====================================================
      // 1. CREATE EMPLOYEE DATABASE RECORD
      // =====================================================

      console.log('ADD EMPLOYEE - STEP 1: Creating employee...');

      const { data: newEmployee, error: insertError } =
        await supabase
          .from('employees')
          .insert({
            employee_number: newEmployeeNumber.trim(),
            first_name: newFirstName.trim(),
            last_name: newLastName.trim(),
            email: newEmail.trim().toLowerCase(),
            role: 'employee',
            is_active: true,
          })
          .select()
          .single();

      if (insertError) {
        console.error('ADD EMPLOYEE DATABASE ERROR:', insertError);

        const detailedError = [
          'Database Error',
          `Code: ${insertError.code || 'N/A'}`,
          `Message: ${insertError.message || 'N/A'}`,
          `Details: ${insertError.details || 'N/A'}`,
          `Hint: ${insertError.hint || 'N/A'}`,
        ].join('\n');

        setError(detailedError);

        return;
      }

      console.log('ADD EMPLOYEE - STEP 1 SUCCESS:', newEmployee);

      // =====================================================
      // 2. GET CURRENT CEO SESSION
      // =====================================================

      console.log('ADD EMPLOYEE - STEP 2: Getting current session...');

      const {
        data: { session: currentSession },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('ADD EMPLOYEE - SESSION ERROR:', sessionError);

        setError(
          `Employee was created, but the CEO session could not be retrieved: ${sessionError.message}`
        );

        await loadCeoDashboard();

        return;
      }

      if (!currentSession?.access_token) {
        console.error('ADD EMPLOYEE - NO ACCESS TOKEN:', currentSession);

        setError(
          'Employee was created, but there is no active CEO authentication session. Please log out and log in again.'
        );

        await loadCeoDashboard();

        return;
      }

      console.log('ADD EMPLOYEE - STEP 2 SUCCESS: CEO session found.');

      console.log('CEO USER ID:', currentSession.user?.id);

      console.log('ACCESS TOKEN EXISTS:', Boolean(currentSession.access_token));

      // =====================================================
      // 3. INVOKE EDGE FUNCTION WITH EXPLICIT JWT
      // =====================================================

      console.log('ADD EMPLOYEE - STEP 3: Invoking invite-employee...');

      console.log('EMPLOYEE ID BEING SENT:', newEmployee.id);

      const {
        data: inviteData,
        error: inviteError,
      } = await supabase.functions.invoke('invite-employee', {
        body: {
          employeeId: newEmployee.id,
        },
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
        },
      });

      console.log('ADD EMPLOYEE - STEP 3 RESPONSE:', {
        inviteData,
        inviteError,
      });

      // =====================================================
      // 4. HANDLE EDGE FUNCTION ERROR
      // =====================================================

      if (inviteError) {
        console.error('INVITATION ERROR:', inviteError);

        let invitationMessage =
          inviteError.message || 'Unknown Edge Function error.';

        // Try to expose the actual function response
        // when Supabase provides it.
        if (inviteError.context) {
          try {
            const responseText = await inviteError.context.text();

            console.error('EDGE FUNCTION RESPONSE BODY:', responseText);

            if (responseText) {
              try {
                const responseJson = JSON.parse(responseText);

                if (responseJson?.error) {
                  invitationMessage = responseJson.error;
                }
              } catch {
                // Response was not JSON.
              }
            }
          } catch (responseReadError) {
            console.error(
              'COULD NOT READ EDGE FUNCTION RESPONSE:',
              responseReadError
            );
          }
        }

        setError(
          `Employee was created, but the invitation could not be sent:\n\n${invitationMessage}`
        );

        await loadCeoDashboard();

        return;
      }

      // =====================================================
      // 5. HANDLE FUNCTION RESPONSE
      // =====================================================

      if (!inviteData?.success) {
        console.error('INVITATION FUNCTION RETURNED AN ERROR:', inviteData);

        setError(
          inviteData?.error ||
            'Employee was created, but the invitation could not be sent.'
        );

        await loadCeoDashboard();

        return;
      }

      console.log('ADD EMPLOYEE - STEP 4 SUCCESS:', inviteData);

      // =====================================================
      // 6. CLEAR FORM
      // =====================================================

      setNewEmployeeNumber('');
      setNewFirstName('');
      setNewLastName('');
      setNewEmail('');
      setShowAddEmployee(false);

      // =====================================================
      // 7. REFRESH CEO DASHBOARD
      // =====================================================

      await loadCeoDashboard();

      // =====================================================
      // 8. SHOW SUCCESS
      // =====================================================

      setError('');

      alert(
        `Employee created successfully!\n\nInvitation sent to ${newEmployee.email}`
      );
    } catch (err) {
      console.error('ADD EMPLOYEE JAVASCRIPT ERROR:', err);

      setError(
        err.message || 'Something went wrong while creating the employee.'
      );
    } finally {
      setAddingEmployee(false);
    }
  }

  async function handleDeleteEmployee(emp) {
    if (!emp?.id) {
      setError('Invalid employee.');
      return;
    }

    // Never allow deleting the currently logged-in CEO
    if (emp.id === employee?.id) {
      setError('You cannot delete your own CEO account.');
      return;
    }

    const confirmed = window.confirm(
      `Delete ${emp.first_name} ${emp.last_name}?\n\n` +
      `This will:\n` +
      `• Remove their login access\n` +
      `• Delete their Supabase Auth account\n` +
      `• Remove them from the active employee list\n` +
      `• KEEP all of their attendance history\n\n` +
      `This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setDeletingEmployeeId(emp.id);
    setError('');

    try {
      // Get the current CEO session so the Edge Function
      // receives the CEO JWT explicitly.
      const {
        data: { session: currentSession },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('DELETE EMPLOYEE - SESSION ERROR:', sessionError);

        setError(`Could not verify your CEO session: ${sessionError.message}`);

        return;
      }

      if (!currentSession?.access_token) {
        setError('Your CEO session has expired. Please log out and log in again.');

        return;
      }

      const {
        data: deleteData,
        error: deleteError,
      } = await supabase.functions.invoke('delete-employee', {
        body: {
          employeeId: emp.id,
        },
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
        },
      });

      if (deleteError) {
        console.error('DELETE EMPLOYEE ERROR:', deleteError);

        setError(deleteError.message || 'Could not delete employee.');

        return;
      }

      if (!deleteData?.success) {
        setError(deleteData?.error || 'Could not delete employee.');

        return;
      }

      // Refresh CEO dashboard
      await loadCeoDashboard();

      alert(
        `${emp.first_name} ${emp.last_name} was deleted successfully.\n\nTheir attendance history has been preserved.`
      );
    } catch (err) {
      console.error('DELETE EMPLOYEE JAVASCRIPT ERROR:', err);

      setError(
        err.message || 'Something went wrong while deleting the employee.'
      );
    } finally {
      setDeletingEmployeeId(null);
    }
  }

  async function loadTodayAttendance(employeeId) {
    const today = getTodayDate();

    const { data, error } = await supabase
      .from('attendance')
      .select(`
        id,
        employee_id,
        work_date,
        clock_in,
        clock_out,
        clockout_type,
        worked_minutes
      `)
      .eq('employee_id', employeeId)
      .eq('work_date', today)
      .maybeSingle();

    if (error) {
      console.error('ATTENDANCE ERROR:', error);
      setError(error.message);
      return;
    }

    setAttendance(data);
  }

  async function loadAttendanceHistory(employeeId) {
    if (!employeeId) return;

    setHistoryLoading(true);

    try {
      const { data, error } = await supabase
        .from('attendance')
        .select(`
          id,
          work_date,
          clock_in,
          clock_out,
          clockout_type,
          worked_minutes
        `)
        .eq('employee_id', employeeId)
        .order('work_date', {
          ascending: false,
        })
        .limit(30);

      if (error) {
        console.error('ATTENDANCE HISTORY ERROR:', error);
        return;
      }

      setAttendanceHistory(data || []);
    } catch (err) {
      console.error('ATTENDANCE HISTORY JAVASCRIPT ERROR:', err);
    } finally {
      setHistoryLoading(false);
    }
  }

  function getEmployeeAttendance(employeeId) {
    return ceoAttendance.find(
      (record) => record.employee_id === employeeId
    );
  }

  function getTodayDate() {
    const now = new Date();

    return now.toLocaleDateString('en-CA', {
      timeZone: 'Asia/Tbilisi',
    });
  }

  async function handleLogin(event) {
    event.preventDefault();

    setLoginLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('LOGIN ERROR:', error);
      setError(error.message);
    }

    setLoginLoading(false);
  }

  async function handleClockIn() {
    if (!employee) return;

    setAttendanceLoading(true);
    setError('');

    try {
      const now = new Date();
      const workDate = getTodayDate();

      const { data, error } = await supabase
        .from('attendance')
        .insert({
          employee_id: employee.id,
          work_date: workDate,
          clock_in: now.toISOString(),
        })
        .select(`
          id,
          employee_id,
          work_date,
          clock_in,
          clock_out,
          clockout_type,
          worked_minutes
        `)
        .single();

      if (error) {
        console.error('CLOCK IN ERROR:', error);

        if (error.code === '23505') {
          setError('You have already clocked in today.');

          await loadTodayAttendance(employee.id);
        } else {
          setError(error.message);
        }

        return;
      }

      setAttendance(data);

      await loadAttendanceHistory(employee.id);
    } catch (err) {
      console.error('CLOCK IN JAVASCRIPT ERROR:', err);

      setError(err.message || String(err));
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function handleClockOut() {
    if (!employee || !attendance) return;

    setAttendanceLoading(true);
    setError('');

    try {
      const now = new Date();
      const clockIn = new Date(attendance.clock_in);

      const workedMinutes = Math.max(
        0,
        Math.floor((now.getTime() - clockIn.getTime()) / 60000)
      );

      const {
        data,
        error,
      } = await supabase
        .from('attendance')
        .update({
          clock_out: now.toISOString(),
          clockout_type: 'manual',
          worked_minutes: workedMinutes,
        })
        .eq('id', attendance.id)
        .select(`
          id,
          employee_id,
          work_date,
          clock_in,
          clock_out,
          clockout_type,
          worked_minutes
        `)
        .single();

      if (error) {
        console.error('CLOCK OUT ERROR:', error);

        setError(error.message);
        return;
      }

      setAttendance(data);

      await loadAttendanceHistory(employee.id);
    } catch (err) {
      console.error('CLOCK OUT JAVASCRIPT ERROR:', err);

      setError(err.message || String(err));
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();

    setEmployee(null);
    setAttendance(null);
    setAttendanceHistory([]);
    setCeoEmployees([]);
    setCeoAttendance([]);
    setSession(null);
    setEmail('');
    setPassword('');
    setError('');
  }

  function formatTime(timestamp) {
    if (!timestamp) return '-';

    return new Date(timestamp).toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Tbilisi',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatWorkedMinutes(minutes) {
    if (minutes === null || minutes === undefined) {
      return '-';
    }

    const hours = Math.floor(minutes / 60);

    const remainingMinutes = minutes % 60;

    return `${hours}h ${remainingMinutes}m`;
  }

  function formatDate(dateString) {
    if (!dateString) return '-';

    const [year, month, day] = dateString.split('-');

    return `${day}.${month}.${year}`;
  }

  if (window.location.pathname === '/set-password') {
    return <SetPassword />;
  }

  if (loading) {
    return (
      <Shell>
        <section className="la-card">
          <h2 className="la-h2">Loading...</h2>
        </section>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <Hero subtitle="Employee Attendance System" />

        <SectionCard icon={LogIn} eyebrow="Employee Attendance System" title="Employee Login">
          <form onSubmit={handleLogin}>
            <label className="la-label" htmlFor="login-email">
              Email
            </label>

            <input
              id="login-email"
              type="email"
              className="la-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              required
            />

            <label className="la-label" htmlFor="login-password">
              Password
            </label>

            <input
              id="login-password"
              type="password"
              className="la-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />

            <button
              type="submit"
              disabled={loginLoading}
              className="la-btn primary block"
            >
              {loginLoading ? 'Logging in...' : 'Log In'}
            </button>
          </form>

          {error && <Alert>{error}</Alert>}
        </SectionCard>
      </Shell>
    );
  }

  if (session && !employee) {
    return (
      <Shell>
        <Hero />

        <section className="la-card">
          <Alert>{error || 'Loading employee profile...'}</Alert>

          <div className="la-actions">
            <PillButton block onClick={handleLogout}>
              Log Out
            </PillButton>
          </div>
        </section>
      </Shell>
    );
  }

  /*
   * CEO DASHBOARD
   */

  if (employee.role === 'ceo') {
    return (
      <Shell wide onLogout={handleLogout}>
        <Hero eyebrow="CEO Dashboard" />

        <SectionCard icon={User} eyebrow="CEO Dashboard" title={`Welcome, ${employee.first_name}!`}>
          {ceoLoading ? (
            <div className="la-message" role="status">
              Loading CEO dashboard...
            </div>
          ) : (
            <div className="la-grid stats">
              <StatTile value={ceoEmployees.length} label="Employee Records" />

              <StatTile
                value={ceoEmployees.filter((emp) => emp.is_active).length}
                label="Active Employees"
              />

              <StatTile value={ceoAttendance.length} label="Clocked In Today" />

              <StatTile
                value={ceoAttendance.filter((record) => record.clock_out).length}
                label="Completed Today"
              />
            </div>
          )}
        </SectionCard>

        {!ceoLoading && (
          <>
            <SectionCard
              icon={Clock}
              eyebrow="CEO Attendance"
              title="Today's Attendance"
            >
              <div className="la-grid">
                <FeatureTile icon={CalendarDays}>
                  <strong>Date:</strong> {getTodayDate()}
                </FeatureTile>

                <FeatureTile icon={LogIn}>
                  <strong>Clock In:</strong>{' '}
                  {attendance ? formatTime(attendance.clock_in) : '-'}
                </FeatureTile>

                <FeatureTile icon={LogOut}>
                  <strong>Clock Out:</strong>{' '}
                  {attendance ? formatTime(attendance.clock_out) : '-'}
                </FeatureTile>

                <FeatureTile icon={Timer}>
                  <strong>Worked:</strong>{' '}
                  {attendance ? formatWorkedMinutes(attendance.worked_minutes) : '-'}
                </FeatureTile>

                {attendance?.clockout_type && (
                  <FeatureTile icon={UserCheck}>
                    <strong>Clock Out Type:</strong>{' '}
                    {attendance.clockout_type === 'automatic' ? 'Automatic' : 'Manual'}
                  </FeatureTile>
                )}
              </div>

              {!attendance && (
                <PillButton
                  block
                  icon={LogIn}
                  onClick={handleClockIn}
                  disabled={attendanceLoading}
                >
                  {attendanceLoading ? 'Clocking In...' : 'Clock In'}
                </PillButton>
              )}

              {attendance && !attendance.clock_out && (
                <PillButton
                  variant="secondary"
                  block
                  icon={LogOut}
                  onClick={handleClockOut}
                  disabled={attendanceLoading}
                >
                  {attendanceLoading ? 'Clocking Out...' : 'Clock Out'}
                </PillButton>
              )}

              {attendance?.clock_out && (
                <Alert success>You have completed today's attendance.</Alert>
              )}

              {error && <Alert>{error}</Alert>}
            </SectionCard>

            <SectionCard
              icon={CalendarDays}
              eyebrow="Attendance"
              title="Today's Attendance"
              action={
                <PillButton
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  onClick={loadCeoDashboard}
                  disabled={ceoLoading}
                >
                  Refresh
                </PillButton>
              }
            >
              <DataTable
                headers={[
                  'Employee #',
                  'Name',
                  'Status',
                  'Clock In',
                  'Clock Out',
                  'Worked',
                ]}
              >
                {ceoEmployees.map((emp) => {
                  const record = getEmployeeAttendance(emp.id);

                  return (
                    <tr key={emp.id}>
                      <td className="la-td">{emp.employee_number}</td>

                      <td className="la-td">
                        {emp.first_name} {emp.last_name}
                      </td>

                      <td className="la-td">
                        {!record
                          ? 'Not clocked in'
                          : record.clock_out
                            ? 'Completed'
                            : 'Working'}
                      </td>

                      <td className="la-td">
                        {record ? formatTime(record.clock_in) : '-'}
                      </td>

                      <td className="la-td">
                        {record?.clock_out ? formatTime(record.clock_out) : '-'}
                      </td>

                      <td className="la-td">
                        {record ? formatWorkedMinutes(record.worked_minutes) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            </SectionCard>

            <SectionCard
              icon={ListChecks}
              eyebrow="Last 30 records"
              title="My Attendance History"
            >
              {historyLoading ? (
                <div className="la-message" role="status">
                  Loading attendance history...
                </div>
              ) : attendanceHistory.length === 0 ? (
                <div className="la-message">No attendance records yet.</div>
              ) : (
                <DataTable headers={['Date', 'Clock In', 'Clock Out', 'Worked']}>
                  {attendanceHistory.map((record) => (
                    <tr key={record.id}>
                      <td className="la-td">{formatDate(record.work_date)}</td>
                      <td className="la-td">{formatTime(record.clock_in)}</td>
                      <td className="la-td">
                        {record.clock_out ? formatTime(record.clock_out) : 'Still working'}
                      </td>
                      <td className="la-td">
                        {formatWorkedMinutes(record.worked_minutes)}
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </SectionCard>

            <SectionCard
              icon={Users}
              eyebrow="Active Employees"
              title="Employees"
              action={
                <PillButton
                  size="sm"
                  icon={UserPlus}
                  onClick={() => {
                    setShowAddEmployee(!showAddEmployee);
                    setError('');
                  }}
                >
                  {showAddEmployee ? 'Cancel' : '+ Add Employee'}
                </PillButton>
              }
            >
              {showAddEmployee && (
                <form onSubmit={handleAddEmployee} className="la-form-panel">
                  <h3>Add Employee</h3>

                  <label className="la-label" htmlFor="new-employee-number">
                    Employee Number
                  </label>

                  <input
                    id="new-employee-number"
                    type="text"
                    className="la-input"
                    value={newEmployeeNumber}
                    onChange={(event) => setNewEmployeeNumber(event.target.value)}
                    placeholder="EMP006"
                    required
                  />

                  <label className="la-label" htmlFor="new-first-name">
                    First Name
                  </label>

                  <input
                    id="new-first-name"
                    type="text"
                    className="la-input"
                    value={newFirstName}
                    onChange={(event) => setNewFirstName(event.target.value)}
                    placeholder="First name"
                    required
                  />

                  <label className="la-label" htmlFor="new-last-name">
                    Last Name
                  </label>

                  <input
                    id="new-last-name"
                    type="text"
                    className="la-input"
                    value={newLastName}
                    onChange={(event) => setNewLastName(event.target.value)}
                    placeholder="Last name"
                    required
                  />

                  <label className="la-label" htmlFor="new-email">
                    Email
                  </label>

                  <input
                    id="new-email"
                    type="email"
                    className="la-input"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder="employee@example.com"
                    required
                  />

                  <button
                    type="submit"
                    disabled={addingEmployee}
                    className="la-btn primary block"
                  >
                    {addingEmployee ? 'Adding Employee...' : 'Add Employee'}
                  </button>
                </form>
              )}

              <DataTable
                headers={['Employee #', 'Name', 'Email', 'Role', 'Status', 'Actions']}
              >
                {ceoEmployees
                  .filter((emp) => emp.is_active)
                  .map((emp) => (
                    <tr key={emp.id}>
                      <td className="la-td">{emp.employee_number}</td>

                      <td className="la-td">
                        {emp.first_name} {emp.last_name}
                      </td>

                      <td className="la-td">{emp.email || '-'}</td>

                      <td className="la-td">{emp.role}</td>

                      <td className="la-td">Active</td>

                      <td className="la-td">
                        {emp.role === 'ceo' ? (
                          <span className="la-protected">Protected</span>
                        ) : (
                          <PillButton
                            variant="secondary"
                            size="sm"
                            icon={Trash2}
                            onClick={() => handleDeleteEmployee(emp)}
                            disabled={deletingEmployeeId === emp.id}
                          >
                            {deletingEmployeeId === emp.id ? 'Deleting...' : 'Delete'}
                          </PillButton>
                        )}
                      </td>
                    </tr>
                  ))}
              </DataTable>
            </SectionCard>
          </>
        )}

        {error && <Alert>{error}</Alert>}

        <PillButton variant="secondary" block icon={LogOut} onClick={handleLogout}>
          Log Out
        </PillButton>
      </Shell>
    );
  }

  /*
   * EMPLOYEE DASHBOARD
   */

  const isClockedIn = attendance && !attendance.clock_out;

  const isClockedOut = attendance && attendance.clock_out;

  return (
    <Shell onLogout={handleLogout}>
      <Hero subtitle="Employee Attendance System" />

      <SectionCard
        icon={User}
        eyebrow="Employee Attendance System"
        title={`Welcome, ${employee.first_name}!`}
      >
        <div className="la-grid">
          <FeatureTile icon={User}>
            <strong>Name:</strong> {employee.first_name} {employee.last_name}
          </FeatureTile>

          <FeatureTile icon={Hash}>
            <strong>Employee #:</strong> {employee.employee_number}
          </FeatureTile>

          <FeatureTile icon={BadgeCheck}>
            <strong>Role:</strong> {employee.role}
          </FeatureTile>
        </div>
      </SectionCard>

      <SectionCard icon={Clock} eyebrow="Attendance" title="Today's Attendance">
        <div className="la-grid">
          <FeatureTile icon={CalendarDays}>
            <strong>Date:</strong> {getTodayDate()}
          </FeatureTile>

          <FeatureTile icon={LogIn}>
            <strong>Clock In:</strong>{' '}
            {attendance ? formatTime(attendance.clock_in) : '-'}
          </FeatureTile>

          <FeatureTile icon={LogOut}>
            <strong>Clock Out:</strong>{' '}
            {attendance ? formatTime(attendance.clock_out) : '-'}
          </FeatureTile>

          <FeatureTile icon={Timer}>
            <strong>Worked:</strong>{' '}
            {attendance ? formatWorkedMinutes(attendance.worked_minutes) : '-'}
          </FeatureTile>

          {attendance?.clockout_type && (
            <FeatureTile icon={UserCheck}>
              <strong>Clock Out Type:</strong>{' '}
              {attendance.clockout_type === 'automatic' ? 'Automatic' : 'Manual'}
            </FeatureTile>
          )}
        </div>

        {!attendance && (
          <PillButton
            block
            icon={LogIn}
            onClick={handleClockIn}
            disabled={attendanceLoading}
          >
            {attendanceLoading ? 'Clocking In...' : 'Clock In'}
          </PillButton>
        )}

        {isClockedIn && (
          <PillButton
            variant="secondary"
            block
            icon={LogOut}
            onClick={handleClockOut}
            disabled={attendanceLoading}
          >
            {attendanceLoading ? 'Clocking Out...' : 'Clock Out'}
          </PillButton>
        )}

        {isClockedOut && (
          <Alert success>You have completed today's attendance.</Alert>
        )}

        {error && <Alert>{error}</Alert>}
      </SectionCard>

      <SectionCard icon={ListChecks} eyebrow="Last 30 records" title="Attendance History">
        {historyLoading ? (
          <div className="la-message" role="status">
            Loading attendance history...
          </div>
        ) : attendanceHistory.length === 0 ? (
          <div className="la-message">No attendance records yet.</div>
        ) : (
          <DataTable headers={['Date', 'Clock In', 'Clock Out', 'Worked']}>
            {attendanceHistory.map((record) => (
              <tr key={record.id}>
                <td className="la-td">{formatDate(record.work_date)}</td>

                <td className="la-td">{formatTime(record.clock_in)}</td>

                <td className="la-td">
                  {record.clock_out ? formatTime(record.clock_out) : 'Still working'}
                </td>

                <td className="la-td">
                  {formatWorkedMinutes(record.worked_minutes)}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <PillButton variant="secondary" block icon={LogOut} onClick={handleLogout}>
        Log Out
      </PillButton>
    </Shell>
  );
}

export default App;