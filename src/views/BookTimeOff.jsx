import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { useToast } from '../components/Toast';
import BalanceCards from '../components/BalanceCards';
import { Alert, Field, Message, SectionCard } from '../components/ui';
import { fetchLeaveBalance, fetchLeaveOptions, listHolidays, requestLeave } from '../services/api';
import { CATEGORIES, categoryLabel, validateLeaveForm, workingDays, workingDaysInYear } from '../lib/leaves';
import { parseYmd } from '../lib/calendar';
import { todayInTz } from '../lib/time';

/** "Book time off": every account (employee, head, CEO, developer) asks for a vacation, unpaid leave or day off here. */
export default function BookTimeOff({ onBooked }) {
  const { employee, timezone } = useAuth();
  const toast = useToast();
  const today = todayInTz(timezone);
  const thisYear = parseYmd(today).y;

  const options = useLoad(fetchLeaveOptions);
  const holidays = useLoad(() => listHolidays({ from: `${thisYear}-01-01`, to: `${thisYear + 2}-12-31` }));
  const balanceNow = useLoad(() => fetchLeaveBalance(employee.id, thisYear), [employee.id, thisYear]);
  const balanceNext = useLoad(() => fetchLeaveBalance(employee.id, thisYear + 1), [employee.id, thisYear]);

  const [form, setForm] = useState({ category: 'vacation', start: '', end: '', comment: '', approverId: '', replacementId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const approvers = useMemo(() => options.data?.approvers ?? [], [options.data]);
  const replacements = useMemo(() => options.data?.replacements ?? [], [options.data]);
  const replacementRequired = Boolean(options.data?.replacement_required);

  // Pre-select the person's usual approver (else the first one, which is the department head when there is one).
  useEffect(() => {
    if (approvers.length > 0 && !form.approverId) {
      const preferred = options.data?.default_approver_id;
      setForm((f) => ({ ...f, approverId: approvers.some((a) => a.id === preferred) ? preferred : approvers[0].id }));
    }
  }, [approvers, options.data, form.approverId]);

  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);
  const validRange = form.start && form.end && form.end >= form.start;
  const days = validRange ? workingDays(form.start, form.end, holidaySet) : null;
  const startYear = form.start ? parseYmd(form.start).y : thisYear;
  const shownYear = startYear === thisYear + 1 ? thisYear + 1 : thisYear;
  const shownBalance = shownYear === thisYear ? balanceNow : balanceNext;

  const yearLines = useMemo(() => {
    if (days === null) return [];
    const lines = [];
    for (let y = parseYmd(form.start).y; y <= parseYmd(form.end).y; y += 1) {
      const n = workingDaysInYear(form.start, form.end, y, holidaySet);
      const rows = y === thisYear ? balanceNow.data : y === thisYear + 1 ? balanceNext.data : null;
      if (n > 0) lines.push({ year: y, days: n, balance: rows?.find((r) => r.category === form.category) ?? null });
    }
    return lines;
  }, [days, form.start, form.end, form.category, holidaySet, balanceNow.data, balanceNext.data, thisYear]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    const problem = validateLeaveForm({ ...form, replacementRequired, today });
    if (problem) return setError(problem);
    if (days === 0) return setError('These dates contain no working days (weekends and public holidays do not count).');
    setBusy(true);
    try {
      await requestLeave({
        category: form.category,
        start: form.start,
        end: form.end,
        comment: form.comment,
        approverId: form.approverId,
        replacementId: replacementRequired ? form.replacementId : null,
      });
      toast.success('Leave request sent for approval.');
      setForm((f) => ({ ...f, start: '', end: '', comment: '', replacementId: '' }));
      balanceNow.reload();
      balanceNext.reload();
      onBooked?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionCard icon={CalendarPlus} title={`Your days in ${shownYear}`}>
        {shownBalance.error && <Alert error>{shownBalance.error}</Alert>}
        <BalanceCards rows={shownBalance.data} />
      </SectionCard>

      <SectionCard icon={CalendarPlus} title="Book time off">
        {options.loading && !options.data && <Message>Loading…</Message>}
        {options.error && <Alert error>{options.error}</Alert>}
        {options.data && (
          <form onSubmit={submit}>
            <div className="la-field-grid">
              <Field label="Type" id="leave-type">
                <select id="leave-type" className="la-input" value={form.category} onChange={set('category')}>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </Field>
              <div />
              <Field label="Start date" id="leave-start">
                <input
                  id="leave-start"
                  type="date"
                  className="la-input"
                  value={form.start}
                  min={today}
                  onChange={(e) => setForm((f) => ({ ...f, start: e.target.value, end: f.end && f.end < e.target.value ? e.target.value : f.end }))}
                  required
                />
              </Field>
              <Field label="End date" id="leave-end">
                <input id="leave-end" type="date" className="la-input" value={form.end} min={form.start || today} onChange={set('end')} required />
              </Field>
            </div>

            {days !== null && (
              <div className="la-tile" style={{ marginBottom: 16 }} role="status">
                <div className="la-tile-text">
                  <strong>{days} working {days === 1 ? 'day' : 'days'}</strong>
                  <div className="la-meta">Weekends and public holidays are not counted.</div>
                  {yearLines.map((l) => (
                    <div key={l.year} className="la-meta">
                      {l.year}: {l.days} {l.days === 1 ? 'day' : 'days'}
                      {l.balance ? ` of ${l.balance.remaining} left (${categoryLabel(form.category)})` : ''}
                      {l.balance && l.days > l.balance.remaining ? ' – more than you have left' : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="la-field-grid">
              <Field label="Approved by" id="leave-approver" hint="Your department head, a CEO or the head of a department that approves for everybody. Whoever you choose answers the request.">
                <select id="leave-approver" className="la-input" value={form.approverId} onChange={set('approverId')} required>
                  <option value="" disabled>Select…</option>
                  {approvers.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>
                  ))}
                </select>
              </Field>
              {replacementRequired && (
                <Field label="Replacement" id="leave-replacement" hint="A colleague from your department who takes over your tasks. Not someone who is on approved leave in the same dates.">
                  <select id="leave-replacement" className="la-input" value={form.replacementId} onChange={set('replacementId')} required>
                    <option value="" disabled>Select a colleague…</option>
                    {replacements.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <Field label="Comment (optional)" id="leave-comment">
              <textarea id="leave-comment" className="la-input" value={form.comment} onChange={set('comment')} maxLength={500} rows={3} />
            </Field>

            {error && <Alert error>{error}</Alert>}
            {approvers.length === 0 && <Alert error>There is nobody who can approve your leave yet. Ask your CEO.</Alert>}
            <button type="submit" className="la-btn primary block" disabled={busy || approvers.length === 0} style={{ marginTop: 16 }}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
          </form>
        )}
      </SectionCard>
    </>
  );
}
