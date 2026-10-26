import { useState } from 'react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { useAuth } from '../hooks/useAuth';
import PhotoEditor from './PhotoEditor';
import { Alert, Field, PillButton } from './ui';
import { updateMyProfile } from '../services/api';
import { todayInTz } from '../lib/time';

/** Everyone's own profile: photo, first name, last name and birth date (nothing else is theirs to change). */
export default function MyProfile({ onClose, onSaved }) {
  const { employee, myProfile, timezone, reloadMe } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    firstName: employee.first_name,
    lastName: employee.last_name,
    birthDate: myProfile?.birth_date ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const today = todayInTz(timezone);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!form.firstName.trim() || !form.lastName.trim()) return setError('Enter your first and last name.');
    if (form.birthDate && form.birthDate > today) return setError('The birth date must be in the past.');
    setBusy(true);
    try {
      await updateMyProfile(form);
      await reloadMe();
      onSaved?.();
      toast.success('Profile saved.');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="My profile" description="You can change your photo, name and birth date. Everything else is managed by your CEO." onClose={busy ? () => {} : onClose}>
      <PhotoEditor employee={employee} path={myProfile?.avatar_path} onChanged={async () => { await reloadMe(); onSaved?.(); }} />
      <form onSubmit={submit}>
        <div className="la-field-grid">
          <Field label="First name" id="me-first">
            <input id="me-first" className="la-input" value={form.firstName} maxLength={100} onChange={set('firstName')} required autoComplete="given-name" />
          </Field>
          <Field label="Last name" id="me-last">
            <input id="me-last" className="la-input" value={form.lastName} maxLength={100} onChange={set('lastName')} required autoComplete="family-name" />
          </Field>
        </div>
        <Field label="Date of birth" id="me-birth" hint="Used for the birthday calendar.">
          <input id="me-birth" type="date" className="la-input" value={form.birthDate} min="1900-01-01" max={today} onChange={set('birthDate')} />
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
