import { useState } from 'react';
import { Fingerprint, Plus, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { Alert, DataTable, Field, Message, PillButton, SectionCard } from './ui';
import { biometricSupport, guessDeviceName, registerThisDevice } from '../lib/biometric';
import { removeDevice } from '../services/api';
import { formatDateTime } from '../lib/time';

/** Enrol this phone/laptop: needs the account password, then Face ID / fingerprint. */
export function RegisterDeviceModal({ onClose, onRegistered }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [name, setName] = useState(guessDeviceName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const support = await biometricSupport();
      if (!support.supported) throw new Error(support.reason);
      await registerThisDevice(password, name.trim() || guessDeviceName());
      toast.success('Device registered. You can now clock in with Face ID / fingerprint.');
      onRegistered();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Register this device"
      description="Confirm your password, then approve with Face ID or your fingerprint. Your biometric data never leaves this device."
      onClose={busy ? () => {} : onClose}
    >
      <form onSubmit={handleSubmit}>
        <Field label="Your password" id="reg-password">
          <input
            id="reg-password"
            type="password"
            className="la-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="Device name" id="reg-name">
          <input id="reg-name" className="la-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        {error && <Alert error>{error}</Alert>}
        <div className="la-modal-actions">
          <PillButton variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </PillButton>
          <button type="submit" className="la-btn primary" disabled={busy || !password}>
            {busy ? 'Waiting for Face ID / fingerprint…' : 'Register'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** The signed-in employee's own registered devices. */
export function DevicesCard({ devices, loading, timezone, onChanged, onRegister }) {
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
    <SectionCard
      icon={Fingerprint}
     
      title="My Devices"
      action={
        <PillButton variant="secondary" size="sm" icon={Plus} onClick={onRegister}>
          Register this device
        </PillButton>
      }
    >
      {loading ? (
        <Message>Loading…</Message>
      ) : devices.length === 0 ? (
        <Message>No device registered yet. Register this device to clock in with Face ID / fingerprint.</Message>
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
    </SectionCard>
  );
}
