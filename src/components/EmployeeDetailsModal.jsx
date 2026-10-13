import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { Alert, Field, PillButton } from './ui';
import { setEmployeeProfile } from '../services/api';
import { formatHours } from '../lib/timesheet';

/** Personal details of one person (CEO / developer only; the database re-checks every rule). */
export default function EmployeeDetailsModal({ employee, profile, directory, today, defaultHours, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
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

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.birthDate && today && form.birthDate > today) return setError('The birth date must be in the past.');
    if (form.dailyHours !== '' && !(Number(form.dailyHours) > 0 && Number(form.dailyHours) <= 24)) return setError('Working hours per day must be between 0 and 24.');
    setBusy(true);
    try {
      await setEmployeeProfile(employee.id, form);
      toast.success('Details saved.');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Details – ${employee.first_name} ${employee.last_name}`}
      description="Only the person themself, CEOs and developers can see these."
      onClose={busy ? () => {} : onClose}
    >
      <form onSubmit={submit}>
        <div className="la-field-grid">
          <Field label="Date of birth" id="det-birth">
            <input id="det-birth" type="date" className="la-input" value={form.birthDate} min="1900-01-01" max={today} onChange={set('birthDate')} />
          </Field>
          <Field label="Start date at the company" id="det-hire" hint="Anniversaries and length of service count from it.">
            <input id="det-hire" type="date" className="la-input" value={form.hireDate} min="1950-01-01" onChange={set('hireDate')} />
          </Field>
          <Field label="Office" id="det-office">
            <input id="det-office" className="la-input" value={form.office} maxLength={100} onChange={set('office')} placeholder="e.g. Tbilisi" />
          </Field>
          <Field label="Country" id="det-country">
            <input id="det-country" className="la-input" value={form.country} maxLength={100} onChange={set('country')} placeholder="e.g. Georgia" />
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
        {error && <Alert error>{error}</Alert>}
        <div className="la-modal-actions">
          <PillButton variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </PillButton>
          <button type="submit" className="la-btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
