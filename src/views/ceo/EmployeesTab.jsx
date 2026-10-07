import { useState } from 'react';
import { Fingerprint, Mail, Trash2, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { useToast } from '../../components/Toast';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Alert, DataTable, Field, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import {
  deleteEmployee,
  inviteEmployee,
  listDevices,
  removeDevice,
  resendInvite,
  setEmployeeDepartment,
  setEmployeeJobRole,
} from '../../services/api';
import { formatDateTime } from '../../lib/time';

const EMPTY = { employeeNumber: '', firstName: '', lastName: '', email: '', departmentId: '', jobRoleId: '' };

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

export default function EmployeesTab({ directory }) {
  const { employee: me, timezone, settings } = useAuth();
  const toast = useToast();
  const { employees, departments, jobRoles, reloadEmployees, reloadDepartments } = directory;
  const devices = useLoad(() => listDevices());

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');
  const [rowBusy, setRowBusy] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [devicesFor, setDevicesFor] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const rolesFor = (departmentId, includeId) =>
    jobRoles.filter((r) => r.department_id === departmentId && (r.is_active || r.id === includeId));
  const deviceList = (employeeId) => (devices.data ?? []).filter((d) => d.employee_id === employeeId);
  const headOf = (employeeId) => departments.find((d) => d.head_employee_id === employeeId);

  async function handleAdd(event) {
    event.preventDefault();
    setAdding(true);
    setFormError('');
    try {
      const res = await inviteEmployee({
        employeeNumber: form.employeeNumber,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        departmentId: form.departmentId || null,
        jobRoleId: form.jobRoleId || null,
      });
      toast.success(res.message);
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

  const handleResend = (emp) => withRow(emp.id, () => resendInvite(emp.id).then((r) => toast.success(r.message)));

  const handleDepartment = (emp, departmentId) =>
    withRow(
      emp.id,
      () => setEmployeeDepartment(emp.id, departmentId),
      () => {
        toast.success('Department updated.');
        reloadEmployees();
        reloadDepartments(); // moving a head out of their department clears the headship
      },
    );

  const handleJobRole = (emp, jobRoleId) =>
    withRow(
      emp.id,
      () => setEmployeeJobRole(emp.id, jobRoleId),
      () => {
        toast.success('Job role updated.');
        reloadEmployees();
      },
    );

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
  const formRoles = rolesFor(form.departmentId);

  return (
    <>
      <SectionCard
        icon={Users}
        eyebrow="People"
        title="Employees"
        action={
          <PillButton size="sm" icon={UserPlus} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Add Employee'}
          </PillButton>
        }
      >
        {showForm && (
          <form onSubmit={handleAdd} className="la-form-panel">
            <h3>Add Employee</h3>
            <div className="la-field-grid">
              <Field label="Employee Number" id="new-number">
                <input id="new-number" className="la-input" value={form.employeeNumber} onChange={set('employeeNumber')} placeholder="EMP006" maxLength={32} required />
              </Field>
              <Field label="Department" id="new-dept">
                <select
                  id="new-dept"
                  className="la-input"
                  value={form.departmentId}
                  onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value, jobRoleId: '' }))}
                >
                  <option value="">None</option>
                  {activeDepartments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="First Name" id="new-first">
                <input id="new-first" className="la-input" value={form.firstName} onChange={set('firstName')} maxLength={100} required />
              </Field>
              <Field label="Last Name" id="new-last">
                <input id="new-last" className="la-input" value={form.lastName} onChange={set('lastName')} maxLength={100} required />
              </Field>
              {formRoles.length > 0 && (
                <Field label="Job role" id="new-role">
                  <select id="new-role" className="la-input" value={form.jobRoleId} onChange={set('jobRoleId')}>
                    <option value="">None</option>
                    {formRoles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <Field label="Email" id="new-email" hint="An invitation to set a password is sent to this address.">
              <input id="new-email" type="email" className="la-input" value={form.email} onChange={set('email')} placeholder="employee@example.com" required />
            </Field>
            {formError && <Alert error>{formError}</Alert>}
            <button type="submit" className="la-btn primary block" disabled={adding} style={{ marginTop: 16 }}>
              {adding ? 'Sending invitation…' : 'Add & Send Invitation'}
            </button>
          </form>
        )}

        <DataTable
          headers={['Employee #', 'Name', 'Email', 'Department', 'Job role', ...(settings.require_biometric ? ['Devices'] : []), 'Status', 'Actions']}
          minWidth={1100}
        >
          {employees.map((emp) => {
            const isCeo = emp.role === 'ceo';
            const busy = rowBusy === emp.id;
            const head = headOf(emp.id);
            const roles = rolesFor(emp.department_id, emp.job_role_id);
            const myDevices = deviceList(emp.id);
            return (
              <tr key={emp.id}>
                <td className="la-td">{emp.employee_number}</td>
                <td className="la-td">
                  {emp.first_name} {emp.last_name} {head && <Pill tone="ok">Head</Pill>} {isCeo && <Pill>CEO</Pill>}
                </td>
                <td className="la-td">{emp.email || '-'}</td>
                <td className="la-td">
                  <select
                    className="la-input compact"
                    aria-label={`Department for ${emp.first_name} ${emp.last_name}`}
                    value={emp.department_id ?? ''}
                    disabled={busy}
                    onChange={(e) => handleDepartment(emp, e.target.value)}
                  >
                    <option value="">None</option>
                    {departments
                      .filter((d) => d.is_active || d.id === emp.department_id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                  </select>
                </td>
                <td className="la-td">
                  {roles.length === 0 ? (
                    '-'
                  ) : (
                    <select
                      className="la-input compact"
                      aria-label={`Job role for ${emp.first_name} ${emp.last_name}`}
                      value={emp.job_role_id ?? ''}
                      disabled={busy}
                      onChange={(e) => handleJobRole(emp, e.target.value)}
                    >
                      <option value="">None</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  )}
                </td>
                {settings.require_biometric && (
                  <td className="la-td">
                    <PillButton variant="ghost" size="sm" icon={Fingerprint} onClick={() => setDevicesFor(emp)}>
                      {myDevices.length === 0 ? 'None' : `${myDevices.length}`}
                    </PillButton>
                  </td>
                )}
                <td className="la-td">
                  {emp.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="warn">Inactive – delete pending</Pill>}
                </td>
                <td className="la-td">
                  {isCeo || emp.id === me.id ? (
                    <span className="la-protected">Protected</span>
                  ) : (
                    <div className="la-toolbar">
                      {emp.is_active && (
                        <PillButton variant="secondary" size="sm" icon={Mail} onClick={() => handleResend(emp)} disabled={busy}>
                          Resend invite
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

      {toDelete && (
        <ConfirmDialog
          title={`Delete ${toDelete.first_name} ${toDelete.last_name}?`}
          danger
          confirmLabel="Delete permanently"
          busy={rowBusy === toDelete.id}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          message={
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
