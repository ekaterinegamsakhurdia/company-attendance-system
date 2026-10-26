import { useMemo, useState } from 'react';
import { Download, FileText, Pencil, Plus } from 'lucide-react';
import PersonLink from '../../components/PersonLink';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { fetchAttendanceRange } from '../../services/api';
import { Alert, DataTable, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import { downloadCsv, toCsv } from '../../lib/csv';
import { formatDate, formatTime, formatWorked } from '../../lib/time';
import AttendanceEditor from './AttendanceEditor';

const ACCOUNT_LABEL = { employee: 'Employee', ceo: 'CEO', developer: 'Developer' };

/**
 * Attendance records with clock-in / clock-out times and corrections.
 * The date range and the people come from the Reports tab's filters (`employeeIds` null = everyone).
 * readOnly (department heads): same data, no editing.
 */
export default function RecordsReport({ directory, readOnly = false, from, to, employeeIds }) {
  const { timezone, settings, employee: me } = useAuth();
  const isDeveloper = me.role === 'developer';

  const [editor, setEditor] = useState(null); // null | { record }

  const employeesById = useMemo(() => new Map(directory.employees.map((e) => [e.id, e])), [directory.employees]);
  const deptName = (id) => directory.departments?.find((d) => d.id === id)?.name ?? '';
  const roleName = (id) => directory.jobRoles?.find((r) => r.id === id)?.name ?? '';

  const scopeKey = employeeIds ? employeeIds.join(',') : '';
  const rangeValid = Boolean(from && to && from <= to);
  const report = useLoad(
    () =>
      employeeIds && employeeIds.length === 0
        ? Promise.resolve([])
        : fetchAttendanceRange({ from, to, employeeIds }),
    [from, to, scopeKey],
    { enabled: rangeValid },
  );

  const rows = useMemo(() => (rangeValid ? (report.data ?? []) : []), [rangeValid, report.data]);

  const totals = useMemo(() => {
    const minutes = rows.reduce((sum, r) => sum + (r.worked_minutes ?? 0), 0);
    const people = new Set(rows.map((r) => r.employee_id ?? r.employee_name));
    return {
      minutes,
      people: people.size,
      open: rows.filter((r) => !r.clock_out).length,
      online: rows.filter((r) => r.work_mode === 'online').length,
      overtime: rows.reduce((sum, r) => sum + (r.overtime_minutes ?? 0), 0),
    };
  }, [rows]);

  const label = (r) => (r.employee_id ? r.employee_name : `${r.employee_name ?? 'Unknown'} (deleted)`);
  const emp = (r) => employeesById.get(r.employee_id);
  const yesNo = (v) => (v ? 'yes' : 'no');
  // Department name, or "CEO" / "Developer" for people who have none.
  const groupOf = (r) => {
    const e = emp(r);
    const dept = deptName(e?.department_id);
    if (dept) return dept;
    return e && e.role !== 'employee' ? ACCOUNT_LABEL[e.role] ?? '' : '';
  };
  // A CEO can read a developer's records but only a developer can change them.
  const canEdit = (r) => isDeveloper || emp(r)?.role !== 'developer';

  function exportCsv() {
    const csv = toCsv(rows, [
      { label: 'Date', get: (r) => r.work_date },
      { label: 'Employee #', get: (r) => r.employee_number },
      { label: 'Employee', get: label },
      { label: 'Department', get: (r) => deptName(emp(r)?.department_id) },
      { label: 'Job role', get: (r) => roleName(emp(r)?.job_role_id) },
      { label: 'Clock in', get: (r) => formatTime(r.clock_in, timezone) },
      { label: 'Clock out', get: (r) => (r.clock_out ? formatTime(r.clock_out, timezone) : '') },
      { label: 'Worked (minutes)', get: (r) => r.worked_minutes },
      { label: 'Worked (h:mm)', get: (r) => (r.worked_minutes == null ? '' : formatWorked(r.worked_minutes)) },
      { label: 'Clock-out type', get: (r) => r.clockout_type },
      { label: 'Biometric at clock-in', get: (r) => yesNo(r.clock_in_biometric) },
      { label: 'Biometric at clock-out', get: (r) => (r.clock_out ? yesNo(r.clock_out_biometric) : '') },
      { label: 'Account type', get: (r) => ACCOUNT_LABEL[emp(r)?.role] ?? '' },
      { label: 'Work mode', get: (r) => (r.work_mode === 'online' ? 'online' : 'office') },
      { label: 'Overtime (minutes)', get: (r) => r.overtime_minutes ?? 0 },
      { label: 'Overtime (h:mm)', get: (r) => ((r.overtime_minutes ?? 0) > 0 ? formatWorked(r.overtime_minutes) : '') },
    ]);
    downloadCsv(`attendance_${from}_to_${to}.csv`, csv);
  }

  const headers = ['Date', 'Employee', 'Department', 'Clock In', 'Clock Out', 'Worked', 'Type', 'Notes', ...(readOnly ? [] : [''])];

  return (
    <>
      <SectionCard
        icon={FileText}
       
        title="Attendance records"
        action={
          <div className="la-toolbar">
            {!readOnly && (
              <PillButton variant="secondary" size="sm" icon={Plus} onClick={() => setEditor({ record: null })}>
                Add record
              </PillButton>
            )}
            <PillButton size="sm" icon={Download} onClick={exportCsv} disabled={rows.length === 0}>
              Export CSV
            </PillButton>
          </div>
        }
      >
        {!rangeValid && <Alert error>"From" must be on or before "To".</Alert>}
        {report.error && <Alert error>{report.error}</Alert>}

        {rangeValid && (
          <div className="la-summary">
            <span><strong>{rows.length}</strong>records</span>
            <span><strong>{totals.people}</strong>employees</span>
            <span><strong>{formatWorked(totals.minutes)}</strong>total worked</span>
            {totals.open > 0 && <span><strong>{totals.open}</strong>still open</span>}
            {totals.online > 0 && <span><strong>{totals.online}</strong>online days</span>}
            {totals.overtime > 0 && <span><strong>{formatWorked(totals.overtime)}</strong>overtime</span>}
          </div>
        )}

        {report.loading && !report.data ? (
          <Message>Loading report…</Message>
        ) : rangeValid && rows.length === 0 ? (
          <Message>No attendance records in this period.</Message>
        ) : (
          rangeValid && (
            <DataTable headers={headers} minWidth={940}>
              {rows.map((r) => {
                const e = emp(r);
                const role = roleName(e?.job_role_id);
                return (
                  <tr key={r.id}>
                    <td className="la-td">{formatDate(r.work_date)}</td>
                    <td className="la-td">
                      {r.employee_number ? `${r.employee_number} · ` : ''}
                      <PersonLink id={r.employee_id}>{label(r)}</PersonLink>
                    </td>
                    <td className="la-td">
                      {groupOf(r) || '-'}
                      {role ? ` · ${role}` : ''}
                    </td>
                    <td className="la-td">{formatTime(r.clock_in, timezone)}</td>
                    <td className="la-td">{r.clock_out ? formatTime(r.clock_out, timezone) : <Pill tone="ok">Working</Pill>}</td>
                    <td className="la-td">{formatWorked(r.worked_minutes)}</td>
                    <td className="la-td">{r.clockout_type ? (r.clockout_type === 'automatic' ? <Pill tone="warn">Auto</Pill> : 'Manual') : '-'}</td>
                    <td className="la-td">
                      {r.work_mode === 'online' && <Pill tone="online">Online</Pill>}
                      {(r.overtime_minutes ?? 0) > 0 && <Pill tone="ot">+{formatWorked(r.overtime_minutes)} overtime</Pill>}
                      {r.overtime_started_at && !r.clock_out && <Pill tone="ot">Overtime running</Pill>}
                    </td>
                    {!readOnly && (
                      <td className="la-td">
                        {canEdit(r) ? (
                          <PillButton variant="ghost" size="sm" icon={Pencil} onClick={() => setEditor({ record: r })}>
                            Edit
                          </PillButton>
                        ) : (
                          <span className="la-protected">Protected</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </DataTable>
          )
        )}
      </SectionCard>

      {!readOnly && editor && (
        <AttendanceEditor
          record={editor.record}
          employees={isDeveloper ? directory.employees : directory.employees.filter((e) => e.role !== 'developer')}
          timezone={timezone}
          workStart={settings.work_start_time}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            report.reload();
          }}
        />
      )}
    </>
  );
}
