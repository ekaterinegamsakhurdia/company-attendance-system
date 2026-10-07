import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ScrollText } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { fetchAuditLogs } from '../../services/api';
import { Alert, DataTable, Message, PillButton, SectionCard } from '../../components/ui';
import { formatDateTime } from '../../lib/time';

const PAGE = 50;

const ACTION_LABELS = {
  'attendance.create': 'Attendance added',
  'attendance.update': 'Attendance corrected',
  'attendance.delete': 'Attendance deleted',
  'attendance.auto_clock_out': 'Automatic clock-out',
  'employee.invite': 'Employee invited',
  'employee.invite_resend': 'Invitation re-sent',
  'employee.delete': 'Employee deleted',
  'employee.department': 'Department changed',
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
};

export default function AuditTab({ directory }) {
  const { timezone } = useAuth();
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

  return (
    <SectionCard
      icon={ScrollText}
      eyebrow="Accountability"
      title="Audit Log"
      action={
        <PillButton variant="secondary" size="sm" icon={RefreshCw} onClick={() => load(0)} disabled={loading}>
          Refresh
        </PillButton>
      }
    >
      {error && <Alert error>{error}</Alert>}
      {rows.length === 0 && !loading && !error ? (
        <Message>Nothing has been logged yet.</Message>
      ) : (
        <DataTable headers={['When', 'Action', 'By', 'Employee', 'Details']} minWidth={820}>
          {rows.map((log) => {
            const actor = log.actor_user_id ? personName(byAuthId.get(log.actor_user_id)) ?? 'Unknown user' : 'System';
            const subject = personName(byId.get(log.employee_id)) ?? log.metadata?.name ?? log.metadata?.employee_name ?? '-';
            return (
              <tr key={log.id}>
                <td className="la-td">{formatDateTime(log.created_at, timezone)}</td>
                <td className="la-td">{ACTION_LABELS[log.action] ?? log.action}</td>
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
