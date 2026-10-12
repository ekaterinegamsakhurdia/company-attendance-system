import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Alert, Field, PillButton } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { deleteAttendance, saveAttendance } from '../../services/api';
import { fromDateTimeLocal, toDateTimeLocal, todayInTz } from '../../lib/time';

/**
 * Create (record = null) or correct (record = row) an attendance entry.
 * The CEO must give a reason; the database stores it in the audit log.
 */
export default function AttendanceEditor({ record, employees, timezone, workStart, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(record);

  const [employeeId, setEmployeeId] = useState(record?.employee_id ?? '');
  const [clockIn, setClockIn] = useState(
    record ? toDateTimeLocal(record.clock_in, timezone) : `${todayInTz(timezone)}T${(workStart || '11:00').slice(0, 5)}`,
  );
  const [clockOut, setClockOut] = useState(record ? toDateTimeLocal(record.clock_out, timezone) : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  async function run(action, message) {
    setBusy(true);
    setError('');
    try {
      await action();
      toast.success(message);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function validate() {
    if (!isEdit && !employeeId) return 'Choose an employee.';
    if (!clockIn) return 'Clock-in time is required.';
    if (clockOut && clockOut < clockIn) return 'Clock-out cannot be before clock-in.';
    if (reason.trim().length < 3) return 'Please give a reason for this change.';
    return '';
  }

  function handleSave(event) {
    event.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);
    run(
      () =>
        saveAttendance({
          id: record?.id ?? null,
          employeeId: record?.employee_id ?? employeeId,
          clockIn: fromDateTimeLocal(clockIn, timezone),
          clockOut: clockOut ? fromDateTimeLocal(clockOut, timezone) : null,
          reason: reason.trim(),
        }),
      isEdit ? 'Attendance corrected.' : 'Attendance record added.',
    );
  }

  function handleDelete() {
    if (reason.trim().length < 3) return setError('Please give a reason before deleting.');
    run(() => deleteAttendance(record.id, reason.trim()), 'Attendance record deleted.');
  }

  const name = record?.employee_name ?? '';

  return (
    <Modal
      title={isEdit ? 'Correct attendance' : 'Add attendance record'}
      description={`Times are in company time (${timezone}). Every change is written to the audit log.`}
      onClose={onClose}
    >
      <form onSubmit={handleSave}>
        {isEdit ? (
          <p style={{ marginBottom: 16 }}>
            <strong>{name || 'Employee'}</strong>
          </p>
        ) : (
          <Field label="Employee" id="edit-employee">
            <select
              id="edit-employee"
              className="la-input"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Select…</option>
              {employees
                .filter((e) => e.is_active)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_number} – {e.first_name} {e.last_name}
                    {e.role === 'ceo' ? ' (CEO)' : e.role === 'developer' ? ' (Developer)' : ''}
                  </option>
                ))}
            </select>
          </Field>
        )}

        <Field label="Clock in" id="edit-in">
          <input
            id="edit-in"
            type="datetime-local"
            className="la-input"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
          />
        </Field>
        <Field label="Clock out (leave empty if still working)" id="edit-out">
          <input
            id="edit-out"
            type="datetime-local"
            className="la-input"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
          />
        </Field>
        <Field label="Reason (required)" id="edit-reason">
          <textarea
            id="edit-reason"
            className="la-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Forgot to clock in, confirmed by manager"
            maxLength={500}
          />
        </Field>

        {error && <Alert error>{error}</Alert>}

        <div className="la-modal-actions">
          {isEdit &&
            (confirmDelete ? (
              <PillButton variant="danger" onClick={handleDelete} disabled={busy}>
                Yes, delete record
              </PillButton>
            ) : (
              <PillButton variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                Delete…
              </PillButton>
            ))}
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
