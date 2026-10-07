import { useMemo, useState } from 'react';
import { Download, FileText, Pencil, Plus } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { fetchAttendanceRange } from '../../services/api';
import { Alert, DataTable, Field, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import { downloadCsv, toCsv } from '../../lib/csv';
import { formatDate, formatTime, formatWorked, monthStartInTz, todayInTz } from '../../lib/time';
import AttendanceEditor from './AttendanceEditor';

function shiftDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** CEO: full report with corrections. readOnly (department heads): same data, no editing. */
export default function ReportsTab({ directory, readOnly = false }) {
  const { timezone, settings } = useAuth();
  const today = todayInTz(timezone);

  const [from, setFrom] = useState(monthStartInTz(timezone));
  const [to, setTo] = useState(today);
  const [departmentId, setDepartmentId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [editor, setEditor] = useState(null); // null | { record }

  const employeesById = useMemo(() => new Map(directory.employees.map((e) => [e.id, e])), [directory.employees]);
  const deptName = (id) => directory.departments?.find((d) => d.id === id)?.name ?? '';
  const roleName = (id) => directory.jobRoles?.find((r) => r.id === id)?.name ?? '';

  const pickable = directory.employees.filter((e) => !departmentId || e.department_id === departmentId);

  // A department filter without a person narrows the query to that department's employees.
  const scopeIds = departmentId && !employeeId ? pickable.map((e) => e.id) : null;
  const scopeKey = scopeIds ? scopeIds.join(',') : '';

  const rangeValid = Boolean(from && to && from <= to);
  const report = useLoad(
    () =>
      scopeIds && scopeIds.length === 0
        ? Promise.resolve([])
        : fetchAttendanceRange({ from, to, employeeId: employeeId || null, employeeIds: scopeIds }),
    [from, to, employeeId, departmentId, scopeKey],
    { enabled: rangeValid },
  );

  const rows = useMemo(() => (rangeValid ? (report.data ?? []) : []), [rangeValid, report.data]);

  const totals = useMemo(() => {
    const minutes = rows.reduce((sum, r) => sum + (r.worked_minutes ?? 0), 0);
    const people = new Set(rows.map((r) => r.employee_id ?? r.employee_name));
    return { minutes, people: people.size, open: rows.filter((r) => !r.clock_out).length };
  }, [rows]);

  const label = (r) => (r.employee_id ? r.employee_name : `${r.employee_name ?? 'Unknown'} (deleted)`);
  const emp = (r) => employeesById.get(r.employee_id);
  const yesNo = (v) => (v ? 'yes' : 'no');

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
    ]);
    downloadCsv(`attendance_${from}_to_${to}.csv`, csv);
  }

  const headers = ['Date', 'Employee', 'Department', 'Clock In', 'Clock Out', 'Worked', 'Type', ...(readOnly ? [] : [''])];

  return (
    <>
      <SectionCard
        icon={FileText}
        eyebrow="Reports"
        title={readOnly ? 'Department Report' : 'Attendance Report'}
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
        <div className="la-toolbar">
          <Field label="From" id="rep-from">
            <input id="rep-from" type="date" className="la-input compact" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" id="rep-to">
            <input id="rep-to" type="date" className="la-input compact" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {!readOnly && (
            <Field label="Department" id="rep-dept">
              <select
                id="rep-dept"
                className="la-input compact"
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  setEmployeeId('');
                }}
              >
                <option value="">All departments</option>
                {directory.departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Employee" id="rep-emp">
            <select id="rep-emp" className="la-input compact" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">{readOnly ? 'Everyone in my department' : 'All employees'}</option>
              {pickable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_number} – {e.first_name} {e.last_name}
                  {e.is_active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </Field>
          <PillButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom(monthStartInTz(timezone));
              setTo(today);
            }}
          >
            This month
          </PillButton>
          <PillButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom(shiftDays(today, -29));
              setTo(today);
            }}
          >
            Last 30 days
          </PillButton>
        </div>

        {!rangeValid && <Alert error>"From" must be on or before "To".</Alert>}
        {report.error && <Alert error>{report.error}</Alert>}

        {rangeValid && (
          <div className="la-summary">
            <span><strong>{rows.length}</strong>records</span>
            <span><strong>{totals.people}</strong>employees</span>
            <span><strong>{formatWorked(totals.minutes)}</strong>total worked</span>
            {totals.open > 0 && <span><strong>{totals.open}</strong>still open</span>}
          </div>
        )}

        {report.loading && !report.data ? (
          <Message>Loading report…</Message>
        ) : rangeValid && rows.length === 0 ? (
          <Message>No attendance records in this period.</Message>
        ) : (
          rangeValid && (
            <DataTable headers={headers} minWidth={820}>
              {rows.map((r) => {
                const e = emp(r);
                const role = roleName(e?.job_role_id);
                return (
                  <tr key={r.id}>
                    <td className="la-td">{formatDate(r.work_date)}</td>
                    <td className="la-td">
                      {r.employee_number ? `${r.employee_number} · ` : ''}
                      {label(r)}
                    </td>
                    <td className="la-td">
                      {deptName(e?.department_id) || '-'}
                      {role ? ` · ${role}` : ''}
                    </td>
                    <td className="la-td">{formatTime(r.clock_in, timezone)}</td>
                    <td className="la-td">{r.clock_out ? formatTime(r.clock_out, timezone) : <Pill tone="ok">Working</Pill>}</td>
                    <td className="la-td">{formatWorked(r.worked_minutes)}</td>
                    <td className="la-td">{r.clockout_type ? (r.clockout_type === 'automatic' ? <Pill tone="warn">Auto</Pill> : 'Manual') : '-'}</td>
                    {!readOnly && (
                      <td className="la-td">
                        <PillButton variant="ghost" size="sm" icon={Pencil} onClick={() => setEditor({ record: r })}>
                          Edit
                        </PillButton>
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
          employees={directory.employees}
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
