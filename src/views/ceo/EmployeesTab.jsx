import { useState } from 'react';
import { useProfileCard } from '../../hooks/useProfileCard';
import { Fingerprint, Mail, Trash2, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { useToast } from '../../components/Toast';
import { ConfirmDialog, Modal } from '../../components/Modal';
import Avatar from '../../components/Avatar';
import PersonLink from '../../components/PersonLink';
import { Alert, DataTable, Field, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import {
  deleteEmployee,
  inviteEmployee,
  listDevices,
  listProfiles,
  removeDevice,
  resendInvite,
  setEmployeeAccountType,
  setEmployeeDepartment,
  setEmployeeJobRole,
  setEmployeeProfile,
} from '../../services/api';
import { formatDateTime, todayInTz } from '../../lib/time';

const EMPTY = {
  role: 'employee',
  employeeNumber: '',
  firstName: '',
  lastName: '',
  email: '',
  departmentId: '',
  jobRoleId: '',
  birthDate: '',
  hireDate: '',
};

const ACCOUNT_TYPES = [
  { value: 'employee', label: 'Employee' },
  { value: 'ceo', label: 'CEO' },
  { value: 'developer', label: 'Developer' },
];
const accountLabel = (role) => ACCOUNT_TYPES.find((t) => t.value === role)?.label ?? role;

const TYPE_WARNING = {
  developer:
    'A developer can see and change everything in the app, including CEO accounts. Developers are hidden from CEOs, ' +
    'belong to no department and do not clock in.',
  ceo: 'A CEO can see all attendance, correct records and manage employees, departments and settings.',
  employee: 'They become a normal employee. Set their department and job role afterwards.',
};

/* ------------------------------------------------------------------ */
function DevicesModal({ employee, devices, timezone, onClose, onChanged }) {
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  async function handleRemove(device) {
    setBusyId(device.id);
    try {
      await removeDevice(device.id);
      toast.success('Device removed.');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      title={`Devices – ${employee.first_name} ${employee.last_name}`}
      description="Remove a device if it was lost or replaced. The employee can then register a new one with their password."
      onClose={onClose}
    >
      {devices.length === 0 ? (
        <Message>No devices registered.</Message>
      ) : (
        <DataTable headers={['Device', 'Added', 'Last used', '']}>
          {devices.map((d) => (
            <tr key={d.id}>
              <td className="la-td">{d.device_name}</td>
              <td className="la-td">{formatDateTime(d.created_at, timezone)}</td>
              <td className="la-td">{d.last_used_at ? formatDateTime(d.last_used_at, timezone) : '-'}</td>
              <td className="la-td">
                <PillButton variant="danger" size="sm" icon={Trash2} onClick={() => handleRemove(d)} disabled={busyId === d.id}>
                  Remove
                </PillButton>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <div className="la-modal-actions">
        <PillButton variant="secondary" onClick={onClose}>
          Close
        </PillButton>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/** Moving someone into a department that has job roles also needs the role. */
function ChooseRoleModal({ employee, department, roles, busy, onConfirm, onCancel }) {
  const [roleId, setRoleId] = useState('');
  return (
    <Modal
      title={`Move ${employee.first_name} ${employee.last_name} to ${department.name}`}
      description={`${department.name} has job roles, so choose one for ${employee.first_name}.`}
      onClose={busy ? () => {} : onCancel}
    >
      <Field label="Job role" id="move-role">
        <select id="move-role" className="la-input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="" disabled>Select job role…</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </Field>
      <div className="la-modal-actions">
        <PillButton variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </PillButton>
        <PillButton onClick={() => onConfirm(roleId)} disabled={busy || !roleId}>
          {busy ? 'Saving…' : 'Move'}
        </PillButton>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
export default function EmployeesTab({ directory }) {
  const { employee: me, timezone, settings } = useAuth();
  const isDeveloper = me.role === 'developer';
  const toast = useToast();
  const { employees, departments, jobRoles, reloadEmployees, reloadDepartments } = directory;
  const devices = useLoad(() => listDevices());
  const card = useProfileCard();
  const profiles = useLoad(listProfiles, [card?.version]);
  const today = todayInTz(timezone);
  const profileOf = (id) => (profiles.data ?? []).find((p) => p.employee_id === id);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');
  const [rowBusy, setRowBusy] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [devicesFor, setDevicesFor] = useState(null);
  const [moving, setMoving] = useState(null); // { emp, departmentId }
  const [typeChange, setTypeChange] = useState(null); // { emp, role }
  const [filter, setFilter] = useState('all');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const activeRolesFor = (departmentId) => jobRoles.filter((r) => r.department_id === departmentId && r.is_active);
  const rolesFor = (departmentId, includeId) =>
    jobRoles.filter((r) => r.department_id === departmentId && (r.is_active || r.id === includeId));
  const deviceList = (employeeId) => (devices.data ?? []).filter((d) => d.employee_id === employeeId);
  const headOf = (employeeId) => departments.find((d) => d.head_employee_id === employeeId);

  const standaloneForm = form.role !== 'employee';
  const formRoles = activeRolesFor(form.departmentId);

  async function handleAdd(event) {
    event.preventDefault();
    setFormError('');
    if (!standaloneForm) {
      if (!form.departmentId) return setFormError('Choose a department.');
      if (formRoles.length > 0 && !form.jobRoleId) return setFormError('Choose a job role.');
    }
    setAdding(true);
    try {
      const res = await inviteEmployee({
        role: form.role,
        employeeNumber: form.employeeNumber,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        departmentId: standaloneForm ? null : form.departmentId,
        jobRoleId: standaloneForm ? null : form.jobRoleId || null,
        sendNow: false, // save the person first; the invitation is sent later from the list
      });
      toast.success(res.message);
      if (form.birthDate || form.hireDate) {
        try {
          await setEmployeeProfile(res.employeeId, { birthDate: form.birthDate, hireDate: form.hireDate, office: '', country: '', dailyHours: '', approverId: '' });
          profiles.reload();
        } catch (err) {
          toast.error(`${form.firstName} was added, but the dates were not saved: ${err.message}`);
        }
      }
      setForm(EMPTY);
      setShowForm(false);
      reloadEmployees();
    } catch (err) {
      // The function rolls back on failure, so nothing half-created is left behind.
      setFormError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function withRow(id, action, onDone) {
    setRowBusy(id);
    try {
      await action();
      onDone?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRowBusy(null);
    }
  }

  const handleResend = (emp) =>
    withRow(emp.id, () => resendInvite(emp.id).then((r) => {
      toast.success(r.message);
      reloadEmployees(); // the row is no longer faded once the invitation is out
    }));

  const afterOrgChange = (message) => () => {
    toast.success(message);
    reloadEmployees();
    reloadDepartments(); // moving a head out of their department clears the headship
  };

  function handleDepartment(emp, departmentId) {
    // A department that has job roles needs a role too, so ask for it before saving.
    if (activeRolesFor(departmentId).length > 0) {
      setMoving({ emp, departmentId });
      return;
    }
    withRow(emp.id, () => setEmployeeDepartment(emp.id, departmentId, null), afterOrgChange('Department updated.'));
  }

  async function confirmMove(jobRoleId) {
    const { emp, departmentId } = moving;
    setRowBusy(emp.id);
    try {
      await setEmployeeDepartment(emp.id, departmentId, jobRoleId);
      setMoving(null);
      afterOrgChange('Department and job role updated.')();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRowBusy(null);
    }
  }

  const handleJobRole = (emp, jobRoleId) =>
    withRow(
      emp.id,
      () => setEmployeeJobRole(emp.id, jobRoleId),
      () => {
        toast.success('Job role updated.');
        reloadEmployees();
      },
    );

  async function confirmTypeChange() {
    const { emp, role } = typeChange;
    setRowBusy(emp.id);
    try {
      await setEmployeeAccountType(emp.id, role);
      toast.success(`${emp.first_name} is now ${role === 'employee' ? 'an employee' : `a ${accountLabel(role)}`}.`);
      setTypeChange(null);
      reloadEmployees();
      reloadDepartments();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRowBusy(null);
    }
  }

  async function confirmDelete() {
    const emp = toDelete;
    setRowBusy(emp.id);
    try {
      const res = await deleteEmployee(emp.id);
      toast.success(res.message);
    } catch (err) {
      toast.error(err.message);
    } finally {
      // Reload either way: a failed delete leaves the employee deactivated.
      setRowBusy(null);
      setToDelete(null);
      reloadEmployees();
      reloadDepartments();
    }
  }

  const activeDepartments = departments.filter((d) => d.is_active);
  const visible = employees.filter((e) => filter === 'all' || e.role === filter);
  const counts = ACCOUNT_TYPES.map((t) => ({ ...t, n: employees.filter((e) => e.role === t.value).length }));

  return (
    <>
      <SectionCard
        icon={Users}
       
        title={isDeveloper ? 'Accounts' : 'Employees'}
        action={
          <PillButton size="sm" icon={UserPlus} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : isDeveloper ? 'Add Account' : 'Add Employee'}
          </PillButton>
        }
      >
        {showForm && (
          <form onSubmit={handleAdd} className="la-form-panel">
            <h3>{isDeveloper ? 'Add Account' : 'Add Employee'}</h3>
            <div className="la-field-grid">
              {isDeveloper && (
                <Field label="Account type" id="new-type" hint="CEOs and developers belong to no department.">
                  <select
                    id="new-type"
                    className="la-input"
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value, departmentId: '', jobRoleId: '' }))}
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Employee Number" id="new-number">
                <input id="new-number" className="la-input" value={form.employeeNumber} onChange={set('employeeNumber')} placeholder="EMP006" maxLength={32} required />
              </Field>
              <Field label="First Name" id="new-first">
                <input id="new-first" className="la-input" value={form.firstName} onChange={set('firstName')} maxLength={100} required />
              </Field>
              <Field label="Last Name" id="new-last">
                <input id="new-last" className="la-input" value={form.lastName} onChange={set('lastName')} maxLength={100} required />
              </Field>
              {!standaloneForm && (
                <Field label="Department" id="new-dept">
                  <select
                    id="new-dept"
                    className="la-input"
                    value={form.departmentId}
                    onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value, jobRoleId: '' }))}
                    required
                  >
                    <option value="" disabled>Select department…</option>
                    {activeDepartments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              {!standaloneForm && formRoles.length > 0 && (
                <Field label="Job role" id="new-role">
                  <select id="new-role" className="la-input" value={form.jobRoleId} onChange={set('jobRoleId')} required>
                    <option value="" disabled>Select job role…</option>
                    {formRoles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Date of birth (optional)" id="new-birth">
                <input id="new-birth" type="date" className="la-input" value={form.birthDate} max={today} onChange={set('birthDate')} />
              </Field>
              <Field label="Start date (optional)" id="new-hire" hint="Used for work anniversaries.">
                <input id="new-hire" type="date" className="la-input" value={form.hireDate} onChange={set('hireDate')} />
              </Field>
            </div>
            {!standaloneForm && form.departmentId && formRoles.length === 0 && (
              <p className="la-meta">This department has no job roles yet{isDeveloper ? '. You can add some under Structure.' : ', so none is needed.'}</p>
            )}
            <Field label="Email" id="new-email" hint="Nothing is sent now. Use Send invitation in the list when you want them to get their login e-mail.">
              <input id="new-email" type="email" className="la-input" value={form.email} onChange={set('email')} placeholder="employee@example.com" required />
            </Field>
            {formError && <Alert error>{formError}</Alert>}
            <button type="submit" className="la-btn primary block" disabled={adding} style={{ marginTop: 16 }}>
              {adding ? 'Saving…' : isDeveloper ? 'Save account' : 'Save employee'}
            </button>
          </form>
        )}

        {isDeveloper && (
          <div className="la-toolbar">
            <Field label="Show" id="emp-filter">
              <select id="emp-filter" className="la-input compact" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All accounts ({employees.length})</option>
                {counts.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}s ({t.n})</option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <p className="la-meta">Click a name to open the person's card: their details, photo, leave days and the Edit button.</p>

        <DataTable
          headers={['Employee #', 'Name', 'Email', ...(isDeveloper ? ['Account type'] : []), 'Department', 'Job role', ...(settings.require_biometric ? ['Devices'] : []), 'Status', 'Actions']}
          minWidth={isDeveloper ? 1200 : 1100}
        >
          {visible.map((emp) => {
            const standalone = emp.role !== 'employee';
            const isSelf = emp.id === me.id;
            const busy = rowBusy === emp.id;
            const head = headOf(emp.id);
            const roles = rolesFor(emp.department_id, emp.job_role_id);
            const myDevices = deviceList(emp.id);
            const canManage = isDeveloper || !(standalone || isSelf);
            const notInvited = !emp.auth_user_id; // saved, but no invitation e-mail has been sent yet
            return (
              <tr key={emp.id} className={notInvited ? 'la-row-pending' : undefined}>
                <td className="la-td">{emp.employee_number}</td>
                <td className="la-td">
                  <div className="la-person-cell">
                    <Avatar person={emp} path={profileOf(emp.id)?.avatar_path} size="sm" />
                    <span>
                      <PersonLink id={emp.id}>{emp.first_name} {emp.last_name}</PersonLink> {head && <Pill tone="ok">Head</Pill>}{' '}
                      {emp.role === 'ceo' && <Pill>CEO</Pill>} {emp.role === 'developer' && <Pill tone="warn">Developer</Pill>}
                    </span>
                  </div>
                </td>
                <td className="la-td">{emp.email || '-'}</td>
                {isDeveloper && (
                  <td className="la-td">
                    <select
                      className="la-input compact"
                      aria-label={`Account type for ${emp.first_name} ${emp.last_name}`}
                      value={emp.role}
                      disabled={busy || isSelf}
                      title={isSelf ? 'You cannot change your own account type.' : undefined}
                      onChange={(e) => setTypeChange({ emp, role: e.target.value })}
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </td>
                )}
                <td className="la-td">
                  {standalone ? (
                    '-'
                  ) : (
                    <select
                      className="la-input compact"
                      aria-label={`Department for ${emp.first_name} ${emp.last_name}`}
                      value={emp.department_id ?? ''}
                      disabled={busy}
                      onChange={(e) => handleDepartment(emp, e.target.value)}
                    >
                      {!emp.department_id && <option value="" disabled>Select…</option>}
                      {departments
                        .filter((d) => d.is_active || d.id === emp.department_id)
                        .map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                    </select>
                  )}
                </td>
                <td className="la-td">
                  {standalone || roles.length === 0 ? (
                    '-'
                  ) : (
                    <select
                      className="la-input compact"
                      aria-label={`Job role for ${emp.first_name} ${emp.last_name}`}
                      value={emp.job_role_id ?? ''}
                      disabled={busy}
                      onChange={(e) => handleJobRole(emp, e.target.value)}
                    >
                      {!emp.job_role_id && <option value="" disabled>Select…</option>}
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  )}
                </td>
                {settings.require_biometric && (
                  <td className="la-td">
                    {emp.role === 'developer' ? (
                      '-'
                    ) : (
                      <PillButton variant="ghost" size="sm" icon={Fingerprint} onClick={() => setDevicesFor(emp)}>
                        {myDevices.length === 0 ? 'None' : `${myDevices.length}`}
                      </PillButton>
                    )}
                  </td>
                )}
                <td className="la-td">
                  {!emp.is_active ? <Pill tone="warn">Inactive</Pill> : notInvited ? <Pill>Not invited</Pill> : <Pill tone="ok">Active</Pill>}
                </td>
                <td className="la-td">
                  {!canManage ? (
                    <span className="la-protected">Protected</span>
                  ) : isSelf ? (
                    <span className="la-protected">This is you</span>
                  ) : (
                    <div className="la-toolbar">
                      {emp.is_active && (
                        <PillButton
                          variant={notInvited ? 'primary' : 'secondary'}
                          size="sm"
                          icon={Mail}
                          onClick={() => handleResend(emp)}
                          disabled={busy}
                          title={notInvited
                            ? 'Sends the invitation e-mail so they can set a password and log in.'
                            : 'Sends the invitation again, or a password-reset link if they already have a password (for example when they forgot it).'}
                        >
                          {notInvited ? 'Send invitation' : 'Send login link'}
                        </PillButton>
                      )}
                      <PillButton variant="danger" size="sm" icon={Trash2} onClick={() => setToDelete(emp)} disabled={busy}>
                        {busy ? 'Working…' : 'Delete'}
                      </PillButton>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      </SectionCard>

      {devicesFor && (
        <DevicesModal
          employee={devicesFor}
          devices={deviceList(devicesFor.id)}
          timezone={timezone}
          onClose={() => setDevicesFor(null)}
          onChanged={devices.reload}
        />
      )}

      {moving && (
        <ChooseRoleModal
          employee={moving.emp}
          department={departments.find((d) => d.id === moving.departmentId)}
          roles={activeRolesFor(moving.departmentId)}
          busy={rowBusy === moving.emp.id}
          onCancel={() => setMoving(null)}
          onConfirm={confirmMove}
        />
      )}

      {typeChange && (
        <ConfirmDialog
          title={`Make ${typeChange.emp.first_name} ${typeChange.emp.last_name} ${typeChange.role === 'employee' ? 'an employee' : `a ${accountLabel(typeChange.role)}`}?`}
          danger={typeChange.role === 'developer'}
          confirmLabel="Change account type"
          busy={rowBusy === typeChange.emp.id}
          onCancel={() => setTypeChange(null)}
          onConfirm={confirmTypeChange}
          message={TYPE_WARNING[typeChange.role]}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title={`Delete ${toDelete.first_name} ${toDelete.last_name}?`}
          danger
          confirmLabel="Delete permanently"
          busy={rowBusy === toDelete.id}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          message={
            (toDelete.role !== 'employee' ? `This is a ${accountLabel(toDelete.role)} account.\n\n` : '') +
            'This will:\n' +
            '• Remove their login immediately\n' +
            '• Delete the employee record and their registered devices\n' +
            '• KEEP their attendance history (shown with their name, marked "deleted")\n\n' +
            'This cannot be undone.'
          }
        />
      )}
    </>
  );
}
