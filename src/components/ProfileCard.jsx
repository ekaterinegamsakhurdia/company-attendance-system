import { useCallback, useMemo, useState } from 'react';
import { Mail, Pencil, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { ProfileCardContext } from '../hooks/useProfileCard';
import { Modal } from './Modal';
import AllowanceForm from './AllowanceForm';
import EmployeeEditor from './EmployeeEditor';
import PhotoEditor from './PhotoEditor';
import Avatar from './Avatar';
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

function CardBody({ employee, directory, profiles, startEditing, onChanged }) {
  const { employee: me, timezone, settings, reloadMe } = useAuth();
  const today = todayInTz(timezone);
  const thisYear = parseYmd(today).y;
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState(Boolean(startEditing));
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
  const isDeveloper = me.role === 'developer';
  const canEdit = isDeveloper || employee.role === 'employee' || employee.id === me.id;
  const canPhoto = isDeveloper || employee.id === me.id;
  const row = (label, value) => (
    <div>
      <dt>{label}</dt>
      <dd>{value || '-'}</dd>
    </div>
  );

  const subtitle = [jobRole?.name, dept?.name].filter(Boolean).join(' · ') || (employee.role === 'employee' ? 'No department yet' : 'Company leadership');

  async function afterSave({ account, keepOpen } = {}) {
    await profiles.reload();
    if (account) {
      directory.reloadEmployees?.();
      directory.reloadDepartments?.();
    }
    if (employee.id === me.id) await reloadMe();
    onChanged?.();
    if (!keepOpen) setEditing(false);
  }

  return (
    <>
      <header className="la-pc-head">
        <div className="la-pc-cover" aria-hidden="true" />
        <div className="la-pc-id">
          <Avatar person={employee} path={profile?.avatar_path} size="xxl" />
          <div className="la-pc-name">
            <h2>{employee.first_name} {employee.last_name}</h2>
            <p className="la-pc-sub">{subtitle}</p>
            <div className="la-pc-pills">
              <Pill tone={employee.is_active ? 'ok' : 'warn'}>{employee.is_active ? 'Active' : 'Inactive'}</Pill>
              {employee.role === 'ceo' && <Pill>CEO</Pill>}
              {employee.role === 'developer' && <Pill tone="warn">Developer</Pill>}
              {isHead && <Pill tone="ok">Department head</Pill>}
              <span className="la-meta">Employee # {employee.employee_number}</span>
              {employee.email && (
                <a className="la-pc-mail" href={`mailto:${employee.email}`}>
                  <Mail size={13} aria-hidden="true" /> {employee.email}
                </a>
              )}
            </div>
          </div>
          {canEdit && !editing && (
            <PillButton variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)} className="la-pc-edit">
              Edit details
            </PillButton>
          )}
        </div>
      </header>

      <div className="la-pc-body">
        {profiles.error && <Alert error>{profiles.error}</Alert>}

        {editing ? (
          <section className="la-pc-panel" aria-label="Edit details">
            <h3 className="la-pc-title">Edit details</h3>
            {canPhoto && (
              <PhotoEditor
                employee={employee}
                path={profile?.avatar_path}
                onChanged={async () => {
                  await profiles.reload();
                  if (employee.id === me.id) await reloadMe();
                  onChanged?.();
                }}
              />
            )}
            <EmployeeEditor
              employee={employee}
              profile={profile}
              directory={directory}
              today={today}
              defaultHours={defaultHours}
              canEditAccount={isDeveloper}
              isSelf={employee.id === me.id}
              onCancel={() => setEditing(false)}
              onSaved={afterSave}
            />
          </section>
        ) : (
          <div className="la-pc-grid">
            <section className="la-pc-panel">
              <h3 className="la-pc-title">Work</h3>
              <dl className="la-dl" aria-label="Work details">
                {row('Position', jobRole?.name)}
                {row('Team', dept?.name)}
                {row('Approver', approver)}
                {row('Permission', permissionLabel(employee, isHead))}
              </dl>
            </section>
            <section className="la-pc-panel">
              <h3 className="la-pc-title">Personal</h3>
              <dl className="la-dl" aria-label="Personal details">
                {row('Email', employee.email)}
                {row('Date of birth', profile?.birth_date ? longDate(profile.birth_date) : null)}
                {row('Country', profile?.country)}
                {row('Timezone', settings.timezone)}
              </dl>
            </section>
            <section className="la-pc-panel wide">
              <h3 className="la-pc-title">Employment</h3>
              <dl className="la-dl" aria-label="Employment details">
                {row('Office', profile?.office)}
                {row('Employment date', profile?.hire_date ? longDate(profile.hire_date) : null)}
                {row('Service length', profile?.hire_date ? serviceDetailed(profile.hire_date, today) : null)}
                {row('Working days and hours', `Mon–Fri · ${formatHours(hours)} h per day`)}
              </dl>
            </section>
          </div>
        )}

        <section className="la-pc-panel">
          <div className="la-pc-title-row">
            <h3 className="la-pc-title">Leave days</h3>
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
            <div className="la-form-panel" style={{ marginTop: 12, marginBottom: 0 }}>
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
        </section>

        <section className="la-pc-panel">
          <h3 className="la-pc-title">Upcoming leaves</h3>
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
        </section>
      </div>
    </>
  );
}

/** Wraps a dashboard: any <PersonLink> below it opens that person's profile card. */
export default function ProfileCardProvider({ directory, children }) {
  const [opened, setOpened] = useState({ id: null, edit: false });
  const openId = opened.id;
  const profiles = useLoad(listProfiles, [openId], { enabled: Boolean(openId) });
    // `version` goes up whenever something was saved in a card, so tabs that list profiles can reload.
  const [version, setVersion] = useState(0);
  const open = useCallback((id, { edit = false } = {}) => setOpened({ id, edit }), []);
  const setOpenId = (id) => setOpened({ id, edit: false });
  const value = useMemo(() => ({ open, version }), [open, version]);
  const employee = openId ? directory.employees.find((e) => e.id === openId) : null;

  return (
    <ProfileCardContext.Provider value={value}>
      {children}
      {employee && (
        <Modal title={`${employee.first_name} ${employee.last_name}`} wide bare onClose={() => setOpenId(null)}>
          <CardBody key={employee.id} employee={employee} directory={directory} profiles={profiles} startEditing={opened.edit} onChanged={() => setVersion((v) => v + 1)} />
        </Modal>
      )}
    </ProfileCardContext.Provider>
  );
}
