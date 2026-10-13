import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useToast } from './Toast';
import { Alert, PillButton } from './ui';
import { setLeaveAllowance } from '../services/api';
import { CATEGORIES } from '../lib/leaves';

/**
 * Change one person's yearly allowance per leave type. −/+ add or remove days;
 * clearing a field goes back to the company default.
 * `balances` is { category: { allowance, used, pending } } for the year.
 */
export default function AllowanceForm({ person, balances, year, onDone, onCancel }) {
  const toast = useToast();
  const [values, setValues] = useState(() => Object.fromEntries(CATEGORIES.map((c) => [c.id, String(balances?.[c.id]?.allowance ?? '')])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const bump = (id, delta) =>
    setValues((v) => {
      const n = Number(v[id] === '' ? 0 : v[id]);
      return { ...v, [id]: String(Math.min(366, Math.max(0, (Number.isFinite(n) ? n : 0) + delta))) };
    });

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      let changed = 0;
      for (const c of CATEGORIES) {
        const before = String(balances?.[c.id]?.allowance ?? '');
        if (values[c.id].trim() === before) continue;
        const n = values[c.id].trim() === '' ? null : Number(values[c.id]);
        if (n !== null && (!Number.isInteger(n) || n < 0 || n > 366)) throw new Error(`${c.label}: enter a whole number between 0 and 366.`);
        await setLeaveAllowance(person.id, year, c.id, n);
        changed += 1;
      }
      toast.success(changed ? 'Allowance saved.' : 'Nothing changed.');
      onDone(changed > 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="la-stack">
      {CATEGORIES.map((c) => {
        const b = balances?.[c.id];
        return (
          <div key={c.id} className="la-toolbar" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{c.label}</strong>
              <div className="la-meta">{b ? `${b.used} used${b.pending ? ` · ${b.pending} pending` : ''}` : ''}</div>
            </div>
            <div className="la-stepper">
              <PillButton variant="secondary" size="sm" icon={Minus} aria-label={`Remove a ${c.label} day`} onClick={() => bump(c.id, -1)} disabled={busy} />
              <input
                className="la-input"
                inputMode="numeric"
                aria-label={`${c.label} days per year`}
                placeholder="default"
                value={values[c.id]}
                onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
              />
              <PillButton variant="secondary" size="sm" icon={Plus} aria-label={`Add a ${c.label} day`} onClick={() => bump(c.id, 1)} disabled={busy} />
            </div>
          </div>
        );
      })}
      <p className="la-meta">Days per year for {year}. Clear a field to use the company default again.</p>
      {error && <Alert error>{error}</Alert>}
      <div className="la-modal-actions">
        <PillButton variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </PillButton>
        <button type="submit" className="la-btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save allowance'}
        </button>
      </div>
    </form>
  );
}
