import { useState } from 'react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { Alert, Field, PillButton } from './ui';
import { devSaveLeave } from '../services/api';
import { CATEGORIES, STATUS_LABELS } from '../lib/leaves';

/** Developer only: create or change any leave request, whatever its status or balance. */
export default function DevLeaveModal({ leave, employees, onClose, onSaved }) {
  const toast = useToast();
  const people = employees.filter((e) => e.is_active || e.id === leave?.employee_id);
  const [form, setForm] = useState({
    employeeId: leave?.employee_id ?? '',
    category: leave?.category ?? 'vacation',
    start: leave?.start_date ?? '',
    end: leave?.end_date ?? '',
    status: leave?.status ?? 'approved',
    approverId: leave?.approver_id ?? '',
    replacementId: leave?.replacement_id ?? '',
    comment: leave?.comment ?? '',
    decisionComment: leave?.decision_comment ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const name = (e) => `${e.first_name} ${e.last_name}`;

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!form.employeeId) return setError('Choose the employee.');
    if (!form.start || !form.end) return setError('Choose a start and an end date.');
    if (form.end < form.start) return setError('The end date cannot be before the start date.');
    setBusy(true);
    try {
      await devSaveLeave({ id: leave?.id ?? null, ...form });
      toast.success(leave ? 'Leave saved.' : 'Leave added.');
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
      title={leave ? 'Edit leave' : 'Add leave'}
      description="Developer access: allowances are not checked here, and any status can be set."
      onClose={busy ? () => {} : onClose}
    >
      <form onSubmit={submit}>
        <Field label="Employee" id="dl-emp">
          <select id="dl-emp" className="la-input" value={form.employeeId} onChange={set('employeeId')} required>
            <option value="" disabled>Select…</option>
            {people.map((e) => (
              <option key={e.id} value={e.id}>{name(e)} ({e.employee_number})</option>
            ))}
          </select>
        </Field>
        <div className="la-field-grid">
          <Field label="Type" id="dl-type">
            <select id="dl-type" className="la-input" value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Status" id="dl-status">
            <select id="dl-status" className="la-input" value={form.status} onChange={set('status')}>
              {Object.entries(STATUS_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Start date" id="dl-start">
            <input id="dl-start" type="date" className="la-input" value={form.start} onChange={set('start')} required />
          </Field>
          <Field label="End date" id="dl-end">
            <input id="dl-end" type="date" className="la-input" value={form.end} min={form.start} onChange={set('end')} required />
          </Field>
          <Field label="Approved by" id="dl-approver">
            <select id="dl-approver" className="la-input" value={form.approverId} onChange={set('approverId')}>
              <option value="">-</option>
              {employees.filter((e) => e.is_active && e.id !== form.employeeId).map((e) => (
                <option key={e.id} value={e.id}>{name(e)}</option>
              ))}
            </select>
          </Field>
          <Field label="Replacement" id="dl-replacement">
            <select id="dl-replacement" className="la-input" value={form.replacementId} onChange={set('replacementId')}>
              <option value="">-</option>
              {employees.filter((e) => e.is_active && e.id !== form.employeeId).map((e) => (
                <option key={e.id} value={e.id}>{name(e)}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Comment" id="dl-comment">
          <textarea id="dl-comment" className="la-input" value={form.comment} onChange={set('comment')} maxLength={500} rows={2} />
        </Field>
        <Field label="Decision note" id="dl-note">
          <input id="dl-note" className="la-input" value={form.decisionComment} onChange={set('decisionComment')} maxLength={500} />
        </Field>
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
