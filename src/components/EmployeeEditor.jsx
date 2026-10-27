import { useMemo, useState } from 'react';
import { useToast } from './Toast';
import { Alert, Field, PillButton } from './ui';
import { changeEmail, setEmployeeProfile, updateEmployee } from '../services/api';
import { formatHours } from '../lib/timesheet';

const sameText = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * Edit form shown inside the employee card.
 * Everyone who may open it can change the profile details (birth date, start date, office, country, hours, approver);
 * a developer can also change the account itself (number, name, e-mail, department, job role, active). The database re-checks every rule.
 */
export default function EmployeeEditor({ employee, profile, directory, today, defaultHours, canEditAccount, isSelf, onCancel, onSaved }) {
  const toast = useToast();
  const standalone = employee.role !== 'employee'; // CEOs / developers belong to no department
  const [form, setForm] = useState({
    employeeNumber: employee.employee_number,
    firstName: employee.first_name,
    lastName: employee.last_name,
    email: employee.email ?? '',
    departmentId: employee.department_id ?? '',
    jobRoleId: employee.job_role_id ?? '',
    isActive: employee.is_active,
    birthDate: profile?.birth_date ?? '',
    hireDate: profile?.hire_date ?? '',
    office: profile?.office ?? '',
    country: profile?.country ?? '',
    dailyHours: profile?.daily_hours ? String(Number(profile.daily_hours)) : '',
    approverId: profile?.approver_id ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Who may approve this person: CEOs, developers and (for employees) the head of their department.
  const approvers = useMemo(() => {
    const dept = directory.departments.find((d) => d.id === employee.department_id);
    return directory.employees
      .filter((e) => e.is_active && e.id !== employee.id && (e.role !== 'employee' || (dept && dept.head_employee_id === e.id)))
      .map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`, kind: e.role === 'ceo' ? 'CEO' : e.role === 'developer' ? 'Developer' : 'Department head' }));
  }, [directory, employee]);

  const deptRoles = directory.jobRoles.filter((r) => r.department_id === form.departmentId && (r.is_active || r.id === employee.job_role_id));
  const hasRoles = deptRoles.some((r) => r.is_active);

  const accountChanged =
    form.employeeNumber !== employee.employee_number ||
    form.firstName !== employee.first_name ||
    form.lastName !== employee.last_name ||
    (form.departmentId || null) !== (employee.department_id ?? null) ||
    (form.jobRoleId || null) !== (employee.job_role_id ?? null) ||
    form.isActive !== employee.is_active;
  const emailChanged = !sameText(form.email, employee.email);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.birthDate && today && form.birthDate > today) return setError('The birth date must be in the past.');
    if (form.dailyHours !== '' && !(Number(form.dailyHours) > 0 && Number(form.dailyHours) <= 24)) {
      return setError('Working hours per day must be between 0 and 24.');
    }
    if (canEditAccount && !standalone && form.isActive) {
      if (!form.departmentId) return setError('Choose a department.');
      if (hasRoles && !form.jobRoleId) return setError('Choose a job role.');
    }
    setBusy(true);
    let accountSaved = false;
    try {
      if (canEditAccount && accountChanged) {
        await updateEmployee(employee.id, {
          ...form,
          departmentId: standalone ? null : form.departmentId,
          jobRoleId: standalone ? null : form.jobRoleId,
        });
        accountSaved = true;
      }
      if (canEditAccount && emailChanged) {
        try {
          const res = await changeEmail(employee.id, form.email.trim());
          toast.success(res.message);
          accountSaved = true;
        } catch (err) {
          toast.error(`The e-mail was not changed: ${err.message}`);
        }
      }
      await setEmployeeProfile(employee.id, form);
      toast.success('Details saved.');
      onSaved({ account: accountSaved });
    } catch (err) {
      setError(err.message);
      if (accountSaved) onSaved({ account: true, keepOpen: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="la-editor" aria-label="Edit details">
      {canEditAccount && (
        <fieldset className="la-fieldset">
          <legend>Account</legend>
          <div className="la-field-grid">
            <Field label="Employee Number" id="edit-number">
              <input id="edit-number" className="la-input" value={form.employeeNumber} onChange={set('employeeNumber')} maxLength={32} required />
            </Field>
            <Field label="Email" id="edit-email">
              <input id="edit-email" type="email" className="la-input" value={form.email} onChange={set('email')} required />
            </Field>
            <Field label="First Name" id="edit-first">
              <input id="edit-first" className="la-input" value={form.firstName} onChange={set('firstName')} maxLength={100} required />
            </Field>
            <Field label="Last Name" id="edit-last">
              <input id="edit-last" className="la-input" value={form.lastName} onChange={set('lastName')} maxLength={100} required />
            </Field>
            {!standalone && (
              <Field label="Department" id="edit-dept">
                <select
                  id="edit-dept"
                  className="la-input"
                  value={form.departmentId}
                  onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value, jobRoleId: '' }))}
                >
                  <option value="" disabled>Select department…</option>
                  {directory.departments
                    .filter((d) => d.is_active || d.id === employee.department_id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                </select>
              </Field>
            )}
            {!standalone && hasRoles && (
              <Field label="Job role" id="edit-role">
                <select id="edit-role" className="la-input" value={form.jobRoleId} onChange={set('jobRoleId')}>
                  <option value="" disabled>Select job role…</option>
                  {deptRoles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          {emailChanged && (
            <p className="la-hint la-hint-flow">Changing the e-mail also changes the address they log in with. If they have not been invited yet, the invitation will go to the new address. If they were invited but have not activated, use Send login link afterwards.</p>
          )}
          <label className="la-tile la-toggle" style={{ cursor: isSelf ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={form.isActive} disabled={isSelf} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            <div className="la-tile-text">
              <strong>Active</strong>
              <div className="la-meta">{isSelf ? 'You cannot deactivate your own account.' : 'An inactive account cannot log in or clock in.'}</div>
            </div>
          </label>
        </fieldset>
      )}

      <fieldset className="la-fieldset">
        <legend>Personal</legend>
        <div className="la-field-grid">
          <Field label="Date of birth" id="det-birth">
            <input id="det-birth" type="date" className="la-input" value={form.birthDate} min="1900-01-01" max={today} onChange={set('birthDate')} />
          </Field>
          <Field label="Country" id="det-country">
            <input id="det-country" className="la-input" value={form.country} maxLength={100} onChange={set('country')} placeholder="e.g. Georgia" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="la-fieldset">
        <legend>Work</legend>
        <div className="la-field-grid">
          <Field label="Start date at the company" id="det-hire" hint="Anniversaries and length of service count from it.">
            <input id="det-hire" type="date" className="la-input" value={form.hireDate} min="1950-01-01" onChange={set('hireDate')} />
          </Field>
          <Field label="Office" id="det-office">
            <input id="det-office" className="la-input" value={form.office} maxLength={100} onChange={set('office')} placeholder="e.g. Tbilisi" />
          </Field>
          <Field label="Working hours per day" id="det-hours" hint={`Empty = the company work day (${formatHours(defaultHours)} h). Monday to Friday.`}>
            <input id="det-hours" className="la-input" inputMode="decimal" value={form.dailyHours} onChange={set('dailyHours')} placeholder={formatHours(defaultHours)} />
          </Field>
          <Field label="Approver" id="det-approver" hint="Pre-selected when they book time off. Empty = their department head, else a CEO.">
            <select id="det-approver" className="la-input" value={form.approverId} onChange={set('approverId')}>
              <option value="">Automatic</option>
              {approvers.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      {error && <Alert error>{error}</Alert>}
      <div className="la-editor-actions">
        <PillButton variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </PillButton>
        <button type="submit" className="la-btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
