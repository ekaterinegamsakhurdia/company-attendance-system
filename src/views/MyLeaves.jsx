import { useState } from 'react';
import { CalendarPlus, Plane } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/Modal';
import LeaveCard from '../components/LeaveCard';
import BalanceCards from '../components/BalanceCards';
import { Alert, Field, Message, PillButton, SectionCard } from '../components/ui';
import { cancelLeave, fetchLeaveBalance, listLeaves } from '../services/api';
import { canCancelOwn, splitLeaves } from '../lib/leaves';
import { dateRange, parseYmd } from '../lib/calendar';
import { todayInTz } from '../lib/time';

/** "My leaves": balances, a button to request a leave, and the upcoming and past leave cards. */
export default function MyLeaves({ onBook }) {
  const { employee, timezone } = useAuth();
  const toast = useToast();
  const today = todayInTz(timezone);
  const thisYear = parseYmd(today).y;

  const [year, setYear] = useState(thisYear);
  const [toCancel, setToCancel] = useState(null);
  const [busy, setBusy] = useState(false);

  const leaves = useLoad(() => listLeaves('mine'));
  const balance = useLoad(() => fetchLeaveBalance(employee.id, year), [year, employee.id]);

  const { upcoming, past } = splitLeaves(leaves.data ?? [], today);
  const reloadAll = () => {
    leaves.reload();
    balance.reload();
  };

  async function confirmCancel() {
    setBusy(true);
    try {
      await cancelLeave(toCancel.id);
      toast.success('Request cancelled.');
      setToCancel(null);
      reloadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const renderCards = (list) => (
    <div className="la-leave-list">
      {list.map((l) => (
        <LeaveCard key={l.id} leave={l} timezone={timezone} busy={busy} onCancel={canCancelOwn(l, today) ? setToCancel : undefined} />
      ))}
    </div>
  );

  return (
    <>
      <SectionCard
        icon={Plane}
       
        title="My Leaves"
        action={
          <PillButton size="sm" icon={CalendarPlus} onClick={onBook}>
            Book time off
          </PillButton>
        }
      >
        <div className="la-toolbar">
          <Field label="Year" id="leave-year">
            <select id="leave-year" className="la-input compact" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </Field>
        </div>
        {balance.error && <Alert error>{balance.error}</Alert>}
        <BalanceCards rows={balance.data} />
        <p className="la-meta">Vacation, unpaid leave and days off are counted in working days (Monday to Friday, public holidays excluded). Days waiting for approval are already set aside.</p>
      </SectionCard>

      <SectionCard icon={Plane} title="Upcoming">
        {leaves.error && <Alert error>{leaves.error}</Alert>}
        {leaves.loading && !leaves.data ? <Message>Loading…</Message> : upcoming.length === 0 ? <Message>No upcoming leaves.</Message> : renderCards(upcoming)}
      </SectionCard>

      <SectionCard icon={Plane} title="Past leaves">
        {leaves.loading && !leaves.data ? <Message>Loading…</Message> : past.length === 0 ? <Message>Nothing here yet.</Message> : renderCards(past)}
      </SectionCard>

      {toCancel && (
        <ConfirmDialog
          title="Cancel this request?"
          danger
          confirmLabel="Cancel request"
          busy={busy}
          onCancel={() => setToCancel(null)}
          onConfirm={confirmCancel}
          message={`${dateRange(toCancel.start_date, toCancel.end_date)} will be removed from the calendar and the days are given back.`}
        />
      )}
    </>
  );
}
