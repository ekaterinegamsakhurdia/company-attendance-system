import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ScrollText } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { fetchAuditLogs } from '../../services/api';
import { Alert, DataTable, Field, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import { AUDIT_FILTERS, isImportantAction } from '../../lib/audit';
import { formatDateTime } from '../../lib/time';

const PAGE = 50;

const ACTION_LABELS = {
  'attendance.create': 'Attendance added',
  'attendance.update': 'Attendance corrected',
  'attendance.delete': 'Attendance deleted',
  'attendance.auto_clock_out': 'Automatic clock-out',
  'attendance.online_day': 'Online work day',
  'attendance.overtime_start': 'Overtime started',
  'attendance.overtime': 'Overtime worked',
  'attendance.overtime_unconfirmed': 'Overtime not ended (not counted)',
  'employee.create': 'Employee added (not invited yet)',
  'employee.invite': 'Employee invited',
  'employee.self_update': 'Own name / birth date changed',
  'employee.avatar': 'Profile photo changed',
  'employee.invite_resend': 'Invitation re-sent',
  'employee.password_reset': 'Password-reset link sent',
  'employee.delete': 'Employee deleted',
  'employee.department': 'Department changed',
  'employee.role': 'Account type changed',
  'employee.update': 'Employee data edited',
  'employee.email': 'E-mail changed',
  'job_roles.delete': 'Job role removed',
  'company_settings.update': 'Settings changed',
  'departments.insert': 'Department created',
  'departments.update': 'Department changed',
  'departments.delete': 'Department removed',
  'department.head': 'Department head changed',
  'employee.job_role': 'Job role changed',
  'job_roles.insert': 'Job role created',
  'job_roles.update': 'Job role changed',
  'allowed_networks.insert': 'Network added',
  'allowed_networks.update': 'Network changed',
  'allowed_networks.delete': 'Network removed',
  'webauthn.register': 'Device registered',
  'webauthn.remove': 'Device removed',
  'webauthn.auth_failed': 'Biometric check failed',
  'leave.request': 'Leave requested',
  'leave.approve': 'Leave approved',
  'leave.reject': 'Leave rejected',
  'leave.cancel': 'Leave cancelled',
  'leave.dev_create': 'Leave added (developer)',
  'leave.dev_update': 'Leave edited (developer)',
  'leave.delete': 'Leave deleted',
  'leave.allowance': 'Leave allowance changed',
  'employee.dates': 'Birth / start date changed',
  'employee.profile': 'Profile details changed',
  'holidays.seed': 'Georgian holidays added',
  'public_holidays.insert': 'Holiday added',
  'public_holidays.update': 'Holiday changed',
  'public_holidays.delete': 'Holiday removed',
};

export default function AuditTab({ directory }) {
  const { timezone, employee: me } = useAuth();
  const isDeveloper = me.role === 'developer';
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (offset) => {
    setLoading(true);
    setError('');
    try {
      const page = await fetchAuditLogs({ limit: PAGE, offset });
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  const byAuthId = new Map(directory.employees.filter((e) => e.auth_user_id).map((e) => [e.auth_user_id, e]));
  const byId = new Map(directory.employees.map((e) => [e.id, e]));
  const personName = (e) => (e ? `${e.first_name} ${e.last_name}` : null);
  const actorIsDeveloper = (log) => byAuthId.get(log.actor_user_id)?.role === 'developer';

  // CEOs only ever receive the important entries (the database enforces it); the developer can narrow the full list.
  const shown = useMemo(() => {
    const test = AUDIT_FILTERS.find((f) => f.id === filter)?.test ?? (() => true);
    return isDeveloper ? rows.filter((l) => test(l, { actorIsDeveloper: actorIsDeveloper(l) })) : rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, isDeveloper, directory.employees]);

  return (
    <SectionCard
      icon={ScrollText}
      title={isDeveloper ? 'Audit Log' : 'Important changes'}
      action={
        <PillButton variant="secondary" size="sm" icon={RefreshCw} onClick={() => load(0)} disabled={loading}>
          Refresh
        </PillButton>
      }
    >
      {!isDeveloper && (
        <p className="la-hint">People added or removed, account, department and job-role changes, networks, company settings, attendance corrections and cancelled leaves. Routine activity is not listed here.</p>
      )}
      {isDeveloper && (
        <div className="la-toolbar">
          <Field label="Show" id="audit-filter">
            <select id="audit-filter" className="la-input compact" value={filter} onChange={(e) => setFilter(e.target.value)}>
              {AUDIT_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </Field>
          <span className="la-meta">{shown.length} of {rows.length} loaded entries</span>
        </div>
      )}
      {error && <Alert error>{error}</Alert>}
      {shown.length === 0 && !loading && !error ? (
        <Message>{rows.length === 0 ? (isDeveloper ? 'Nothing has been logged yet.' : 'No important changes have been logged yet.') : 'Nothing matches this filter.'}</Message>
      ) : (
        <DataTable headers={['When', 'Action', 'By', 'Employee', 'Details']} minWidth={820}>
          {shown.map((log) => {
            const actor = log.actor_user_id ? personName(byAuthId.get(log.actor_user_id)) ?? 'Removed user' : 'System';
            const subject = personName(byId.get(log.employee_id)) ?? log.metadata?.name ?? log.metadata?.employee_name ?? '-';
            return (
              <tr key={log.id}>
                <td className="la-td">{formatDateTime(log.created_at, timezone)}</td>
                <td className="la-td">{ACTION_LABELS[log.action] ?? log.action}{isDeveloper && isImportantAction(log.action) && <> <Pill tone="warn">Important</Pill></>}</td>
                <td className="la-td">{actor}</td>
                <td className="la-td">{subject}</td>
                <td className="la-td wrap">
                  {log.metadata?.reason && <div>“{log.metadata.reason}”</div>}
                  {!log.metadata?.reason && log.description && <div className="la-meta">{log.description}</div>}
                  {log.metadata && (
                    <details className="la-details">
                      <summary>Details</summary>
                      <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
                    </details>
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
      {loading && <Message>Loading…</Message>}
      {hasMore && !loading && (
        <PillButton variant="secondary" block onClick={() => load(rows.length)}>
          Load more
        </PillButton>
      )}
    </SectionCard>
  );
}
