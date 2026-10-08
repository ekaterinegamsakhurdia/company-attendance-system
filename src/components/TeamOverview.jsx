import { CalendarDays, RefreshCw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { fetchAttendanceOnDate } from '../services/api';
import { Alert, DataTable, Message, Pill, PillButton, SectionCard, StatTile } from './ui';
import { formatDate, formatTime, formatWorked, todayInTz } from '../lib/time';

/**
 * Who is in today. `directory` holds the employees the signed-in person may see
 * (everyone for the CEO, only the own department for a department head).
 */
export default function TeamOverview({ directory, title = 'Team Overview', onRefresh, children }) {
  const { timezone } = useAuth();
  const today = todayInTz(timezone);
  const team = useLoad(() => fetchAttendanceOnDate(today), [today]);

  const records = team.data ?? [];
  const active = directory.employees.filter((e) => e.is_active && e.role !== 'developer'); // developers do not clock in
  const byEmployee = new Map(records.map((r) => [r.employee_id, r]));
  const deptName = (id) => directory.departments?.find((d) => d.id === id)?.name ?? '-';
  const roleName = (id) => directory.jobRoles?.find((r) => r.id === id)?.name;

  const refresh = () => {
    team.reload();
    directory.reloadEmployees?.();
    onRefresh?.();
  };

  return (
    <>
      <SectionCard icon={CalendarDays} eyebrow={formatDate(today)} title={title}>
        <div className="la-grid stats">
          <StatTile value={active.length} label="Active Employees" />
          <StatTile value={records.length} label="Clocked In Today" />
          <StatTile value={records.filter((r) => !r.clock_out).length} label="Working Now" />
          <StatTile value={records.filter((r) => r.clock_out).length} label="Completed Today" />
        </div>
      </SectionCard>

      {children}

      <SectionCard
        icon={CalendarDays}
        eyebrow="Attendance"
        title="Today's Attendance"
        action={
          <PillButton variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} disabled={team.loading}>
            Refresh
          </PillButton>
        }
      >
        {team.error && <Alert error>{team.error}</Alert>}
        {team.loading && !team.data ? (
          <Message>Loading…</Message>
        ) : (
          <DataTable headers={['Employee #', 'Name', 'Department', 'Status', 'Clock In', 'Clock Out', 'Worked']} minWidth={760}>
            {active.map((emp) => {
              const r = byEmployee.get(emp.id);
              const role = roleName(emp.job_role_id);
              return (
                <tr key={emp.id}>
                  <td className="la-td">{emp.employee_number}</td>
                  <td className="la-td">
                    {emp.first_name} {emp.last_name}
                  </td>
                  <td className="la-td">
                    {deptName(emp.department_id)}
                    {role ? ` · ${role}` : ''}
                  </td>
                  <td className="la-td">
                    {!r ? (
                      <Pill tone="off">Not clocked in</Pill>
                    ) : r.clock_out ? (
                      <Pill>Completed{r.clockout_type === 'automatic' ? ' (auto)' : ''}</Pill>
                    ) : (
                      <Pill tone="ok">Working</Pill>
                    )}
                  </td>
                  <td className="la-td">{r ? formatTime(r.clock_in, timezone) : '-'}</td>
                  <td className="la-td">{r?.clock_out ? formatTime(r.clock_out, timezone) : '-'}</td>
                  <td className="la-td">{r ? formatWorked(r.worked_minutes) : '-'}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </SectionCard>
    </>
  );
}
