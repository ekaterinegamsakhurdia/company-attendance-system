import { useState } from 'react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { Alert, Field, PillButton } from './ui';
import { decideLeave } from '../services/api';
import { categoryLabel } from '../lib/leaves';
import { dateRange } from '../lib/calendar';

/** Approve / reject a request with an optional note for the employee. */
export default function DecideModal({ leave, decision, onClose, onDone }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const approve = decision === 'approved';

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await decideLeave(leave.id, decision, comment);
      toast.success(approve ? 'Leave approved and added to the calendar.' : 'Leave rejected.');
      onDone();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${approve ? 'Approve' : 'Reject'} ${leave.employee_name}'s ${categoryLabel(leave.category).toLowerCase()}?`}
      description={`${dateRange(leave.start_date, leave.end_date)} · ${leave.working_days} working ${leave.working_days === 1 ? 'day' : 'days'}`}
      onClose={busy ? () => {} : onClose}
    >
      <form onSubmit={submit}>
        <Field label="Note for the employee (optional)" id="decide-note">
          <textarea id="decide-note" className="la-input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={3} />
        </Field>
        {error && <Alert error>{error}</Alert>}
        <div className="la-modal-actions">
          <PillButton variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </PillButton>
          <button type="submit" className={`la-btn ${approve ? 'primary' : 'danger'}`} disabled={busy}>
            {busy ? 'Saving…' : approve ? 'Approve' : 'Reject'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
