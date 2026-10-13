import { useCallback, useMemo, useState } from 'react';
import { Pencil, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { ProfileCardContext } from '../hooks/useProfileCard';
import { Modal } from './Modal';
import AllowanceForm from './AllowanceForm';
import EmployeeDetailsModal from './EmployeeDetailsModal';
import { Alert, Message, Pill, PillButton } from './ui';
import { fetchLeaveBalance, listLeaves, listProfiles } from '../services/api';
import { CATEGORIES, balanceMap, categoryLabel, statusLabel, statusTone } from '../lib/leaves';
import { serviceDetailed } from '../lib/celebrations';
import { addDays, dateRange, longDate, parseYmd } from '../lib/calendar';
import { companyHours, formatHours } from '../lib/timesheet';
import { todayInTz } from '../lib/time';

const permissionLabel = (emp, isHead) => (emp.role === 'ceo' ? 'CEO' : emp.role === 'developer' ? 'Developer' : isHead ? 'Department head' : 'User');

function LeaveLine({ leave }) {
  return (
    <li className="la-cal-line">
      <span>
        <strong>{dateRange(leave.start_date, leave.end_date)}</strong>
        <span className="la-meta">
          {' '}· {categoryLabel(leave.category)} · {leave.working_days} {leave.working_days === 1 ? 'day' : 'days'}
          {leave.replacement_name ? ` · replaced by ${leave.replacement_name}` : ''}
        </span>{' '}
        <Pill tone={statusTone(leave.status)}>{statusLabel(leave.status)}</Pill>
      </span>
    </li>
  );
}

function CardBody({ employee, directory, profiles, onClose }) {
  const { employee: me, timezone, settings } = useAuth();
  const today = todayInTz(timezone);
  const thisYear = parseYmd(today).y;
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const profile = profiles.data?.find((p) => p.employee_id === employee.id);
  const dept = directory.departments.find((d) => d.id === employee.department_id);
  const jobRole = directory.jobRoles.find((r) => r.id === employee.job_role_id);
  const isHead = directory.departments.some((d) => d.head_employee_id === employee.id);
  const defaultHours = companyHours(settings.work_start_time, settings.work_end_time);
  const hours = profile?.daily_hours ? Number(profile.daily_hours) : defaultHours;

  // Approver: the chosen one, else the department head, else "CEO".
  const byId = new Map(directory.employees.map((e) => [e.id, e]));
  const nameOf = (id) => (byId.get(id) ? `${byId.get(id).first_name} ${byId.get(id).last_name}` : null);
  const headId = dept?.head_employee_id && dept.head_employee_id !== employee.id ? dept.head_employee_id : null;
  const approver = nameOf(profile?.approver_id) ?? nameOf(headId) ?? 'CEO';

  const balance = useLoad(() => fetchLeaveBalance(employee.id, year), [employee.id, year]);
  const upcoming = useLoad(() => listLeaves('managed', { from: today, employeeId: employee.id }), [employee.id, today]);
  const past = useLoad(
    () => listLeaves('managed', { from: `${thisYear}-01-01`, to: addDays(today, -1), employeeId: employee.id }),
    [employee.id, today, thisYear],
  );
  const bal = balanceMap(balance.data);
  const planned = (upcoming.data ?? []).filter((l) => l.status === 'approved' || l.status === 'pending').sort((a, b) => a.start_date.localeCompare(b.start_date));
  const taken = (past.data ?? []).filter((l) => l.status === 'approved');

  // A CEO may not change another CEO's or the developer's details (the database enforces it too).
  const canEdit = me.role === 'developer' || employee.role === 'employee' || employee.id === me.id;
  const row = (label, value) => (
    <div>
      <dt>{label}</dt>
      <dd>{value || '-'}</dd>
    </div>
  );

  return (
    <>
      <div className="la-toolbar" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <Pill tone={employee.is_active ? 'ok' : 'warn'}>{employee.is_active ? 'Active' : 'Inactive'}</Pill>{' '}
          <span className="la-meta">Employee # {employee.employee_number}</span>
        </div>
        {canEdit && (
          <PillButton variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
            Edit details
          </PillButton>
        )}
      </div>

      {profiles.error && <Alert error>{profiles.error}</Alert>}
      <dl className="la-dl" aria-label="Personal details">
        {row('Email', employee.email)}
        {row('Position', jobRole?.name)}
        {row('Approver', approver)}
        {row('Team', dept?.name)}
        {row('Office', profile?.office)}
        {row('Permission', permissionLabel(employee, isHead))}
        {row('Employment date', profile?.hire_date ? longDate(profile.hire_date) : null)}
        {row('Service length', profile?.hire_date ? serviceDetailed(profile.hire_date, today) : null)}
        {row('Country', profile?.country)}
        {row('Timezone', settings.timezone)}
        {row('Date of birth', profile?.birth_date ? longDate(profile.birth_date) : null)}
        {row('Working days and hours', `Mon–Fri · ${formatHours(hours)} h per day`)}
      </dl>

      <div className="la-toolbar" style={{ justifyContent: 'space-between', marginTop: 20 }}>
        <h3 className="la-section-title">Leave days</h3>
        <div className="la-toolbar">
          <select className="la-input compact" aria-label="Year" value={year} onChange={(e) => { setYear(Number(e.target.value)); setAdjusting(false); }}>
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {canEdit && !adjusting && (
            <PillButton variant="secondary" size="sm" icon={SlidersHorizontal} onClick={() => setAdjusting(true)}>
              Adjust days
            </PillButton>
          )}
        </div>
      </div>
      {balance.error && <Alert error>{balance.error}</Alert>}
      {adjusting ? (
        <div className="la-form-panel" style={{ marginTop: 12 }}>
          <AllowanceForm
            person={employee}
            balances={bal}
            year={year}
            onCancel={() => setAdjusting(false)}
            onDone={(changed) => {
              setAdjusting(false);
              if (changed) balance.reload();
            }}
          />
        </div>
      ) : (
        <div className="la-grid three" style={{ marginTop: 12 }}>
          {CATEGORIES.map((c) => {
            const b = bal[c.id];
            return (
              <div key={c.id} className="la-tile la-stat" aria-label={`${c.label} days`}>
                <span className="la-stat-label">{c.label}</span>
                <strong className={`la-stat-num${b && b.remaining < 0 ? ' la-neg' : ''}`}>{b ? b.remaining : '-'}</strong>
                <span className="la-stat-label">left</span>
                {b && <span className="la-balance-sub">{b.used} used{b.pending ? ` · ${b.pending} pending` : ''} · {b.allowance} a year</span>}
              </div>
            );
          })}
        </div>
      )}

      <h3 className="la-section-title" style={{ marginTop: 20 }}>Upcoming leaves</h3>
      {upcoming.error && <Alert error>{upcoming.error}</Alert>}
      {upcoming.loading && !upcoming.data ? (
        <Message>Loading…</Message>
      ) : planned.length === 0 ? (
        <p className="la-meta" style={{ marginTop: 8 }}>No planned or approved leaves.</p>
      ) : (
        <ul className="la-cal-list" aria-label="Upcoming leaves">
          {planned.map((l) => <LeaveLine key={l.id} leave={l} />)}
        </ul>
      )}

      {taken.length > 0 && (
        <details className="la-details" style={{ marginTop: 14 }}>
          <summary>Leaves already taken this year ({taken.length})</summary>
          <ul className="la-cal-list">
            {taken.map((l) => <LeaveLine key={l.id} leave={l} />)}
          </ul>
        </details>
      )}

      <div className="la-modal-actions" style={{ marginTop: 20 }}>
        <PillButton variant="secondary" onClick={onClose}>
          Close
        </PillButton>
      </div>

      {editing && (
        <EmployeeDetailsModal
          employee={employee}
          profile={profile}
          directory={directory}
          today={today}
          defaultHours={defaultHours}
          onClose={() => setEditing(false)}
          onSaved={() => profiles.reload()}
        />
      )}
    </>
  );
}

/** Wraps a dashboard: any <PersonLink> below it opens that person's profile card. */
export default function ProfileCardProvider({ directory, children }) {
  const [openId, setOpenId] = useState(null);
  const profiles = useLoad(listProfiles, [openId], { enabled: Boolean(openId) });
  const open = useCallback((id) => setOpenId(id), []);
  const value = useMemo(() => ({ open }), [open]);
  const employee = openId ? directory.employees.find((e) => e.id === openId) : null;

  return (
    <ProfileCardContext.Provider value={value}>
      {children}
      {employee && (
        <Modal title={`${employee.first_name} ${employee.last_name}`} wide onClose={() => setOpenId(null)}>
          <CardBody key={employee.id} employee={employee} directory={directory} profiles={profiles} onClose={() => setOpenId(null)} />
        </Modal>
      )}
    </ProfileCardContext.Provider>
  );
}
