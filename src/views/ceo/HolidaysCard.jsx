import { useState } from 'react';
import { CalendarHeart, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { useToast } from '../../components/Toast';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Alert, DataTable, Field, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import { addGeorgianHolidays, addHoliday, deleteHoliday, listHolidays, updateHoliday } from '../../services/api';
import { WEEKDAY_SHORT, longDate, parseYmd, weekdayIndex } from '../../lib/calendar';
import { todayInTz } from '../../lib/time';

function HolidayModal({ holiday, year, onClose, onSaved }) {
  const toast = useToast();
  const [date, setDate] = useState(holiday?.holiday_date ?? `${year}-01-01`);
  const [name, setName] = useState(holiday?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (holiday) await updateHoliday(holiday.id, { date, name });
      else await addHoliday({ date, name });
      toast.success(holiday ? 'Holiday saved.' : 'Holiday added.');
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={holiday ? 'Edit holiday' : 'Add holiday'} description="Holidays appear in everyone's calendar and are not counted as leave days." onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit}>
        <Field label="Date" id="hol-date">
          <input id="hol-date" type="date" className="la-input" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Name" id="hol-name">
          <input id="hol-name" className="la-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
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

/** Public holidays (Georgian ones are added with one click per year; custom days can be added too). */
export default function HolidaysCard() {
  const { timezone } = useAuth();
  const toast = useToast();
  const thisYear = parseYmd(todayInTz(timezone)).y;
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState(null); // holiday | {} for new
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const holidays = useLoad(() => listHolidays({ from: `${year}-01-01`, to: `${year}-12-31` }), [year]);

  async function seed() {
    setBusy(true);
    try {
      const added = await addGeorgianHolidays(year);
      toast.success(added > 0 ? `${added} Georgian holidays added for ${year}.` : `The Georgian holidays for ${year} are already there.`);
      holidays.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await deleteHoliday(toDelete.id);
      toast.success('Holiday removed.');
      setToDelete(null);
      holidays.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionCard
        icon={CalendarHeart}
        eyebrow="Calendar"
        title="Public Holidays"
        action={
          <PillButton size="sm" icon={Plus} onClick={() => setEditing({})}>
            Add holiday
          </PillButton>
        }
      >
        <div className="la-toolbar">
          <Field label="Year" id="hol-year">
            <select id="hol-year" className="la-input compact" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, i) => thisYear - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </Field>
          <PillButton variant="secondary" size="sm" onClick={seed} disabled={busy}>
            Add Georgian holidays for {year}
          </PillButton>
        </div>
        <p className="la-meta">
          Holidays are shown in everyone&apos;s calendar and are not counted as leave days. Georgian holidays are filled in for 2025–2040; Orthodox Easter is calculated.
          If the government moves a day off or declares an extra one, add or edit it here.
        </p>
        {holidays.error && <Alert error>{holidays.error}</Alert>}
        {holidays.loading && !holidays.data ? (
          <Message>Loading…</Message>
        ) : (holidays.data ?? []).length === 0 ? (
          <Message>No holidays for {year}.</Message>
        ) : (
          <DataTable headers={['Date', 'Day', 'Holiday', 'Source', 'Actions']} minWidth={640}>
            {holidays.data.map((h) => (
              <tr key={h.id}>
                <td className="la-td">{longDate(h.holiday_date)}</td>
                <td className="la-td">{WEEKDAY_SHORT[weekdayIndex(h.holiday_date)]}</td>
                <td className="la-td wrap">{h.name}</td>
                <td className="la-td">{h.is_official ? <Pill tone="ok">Georgia</Pill> : <Pill>Custom</Pill>}</td>
                <td className="la-td">
                  <div className="la-toolbar">
                    <PillButton variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(h)}>
                      Edit
                    </PillButton>
                    <PillButton variant="danger" size="sm" icon={Trash2} onClick={() => setToDelete(h)}>
                      Delete
                    </PillButton>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      {editing && <HolidayModal holiday={editing.id ? editing : null} year={year} onClose={() => setEditing(null)} onSaved={holidays.reload} />}
      {toDelete && (
        <ConfirmDialog
          title={`Remove ${toDelete.name}?`}
          danger
          confirmLabel="Remove holiday"
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          message={`${longDate(toDelete.holiday_date)} will count as a normal working day again.`}
        />
      )}
    </>
  );
}
