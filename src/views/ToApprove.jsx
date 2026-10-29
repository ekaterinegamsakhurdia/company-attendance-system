import { useMemo, useState } from 'react';
import { CalendarCheck, Check, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { useToast } from '../components/Toast';
import DecideModal from '../components/DecideModal';
import PersonLink from '../components/PersonLink';
import { Alert, Message, Pill, PillButton, SectionCard } from '../components/ui';
import { decideLeave, fetchAllBalances } from '../services/api';
import { canDecide, categoryLabel } from '../lib/leaves';
import { dateRange, longDate, parseYmd } from '../lib/calendar';

/**
 * Leaves waiting for the signed-in CEO, developer or department head.
 * Approve is one click; reject asks for an optional note.
 */
export default function ToApprove({ pending, onChanged }) {
  const { employee: me, headDepartment } = useAuth();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const waiting = useMemo(
    () => (pending.data ?? []).filter((l) => canDecide(l, me, headDepartment)).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [pending.data, me, headDepartment],
  );
  const years = [...new Set(waiting.map((l) => parseYmd(l.start_date).y))].sort();
  const balances = useLoad(
    async () => {
      const out = {};
      for (const y of years) {
        const rows = await fetchAllBalances(y);
        for (const r of rows) out[`${y}|${r.employee_id}|${r.category}`] = r;
      }
      return out;
    },
    [years.join(',')],
    { enabled: years.length > 0 },
  );

  const reload = () => {
    pending.reload();
    balances.reload();
    onChanged?.();
  };

  async function approve(leave) {
    setBusyId(leave.id);
    try {
      await decideLeave(leave.id, 'approved', null);
      toast.success(`${leave.employee_name}'s ${categoryLabel(leave.category).toLowerCase()} approved and added to the calendar.`);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <SectionCard icon={CalendarCheck} title="Leaves to approve">
        {pending.error && <Alert error>{pending.error}</Alert>}
        {pending.loading && !pending.data ? (
          <Message>Loading…</Message>
        ) : waiting.length === 0 ? (
          <Message>Nothing to approve right now.</Message>
        ) : (
          <div className="la-leave-list">
            {waiting.map((l) => {
              const year = parseYmd(l.start_date).y;
              const b = balances.data?.[`${year}|${l.employee_id}|${l.category}`];
              return (
                <article key={l.id} className="la-leave-card" aria-label={`${l.employee_name} ${categoryLabel(l.category)}`}>
                  <div className="la-leave-top">
                    <strong><PersonLink id={l.employee_id}>{l.employee_name}</PersonLink></strong>
                    <Pill>{categoryLabel(l.category)}</Pill>
                  </div>
                  <div className="la-leave-dates">{dateRange(l.start_date, l.end_date)}</div>
                  <dl className="la-leave-facts">
                    <dt>Working days</dt>
                    <dd>{l.working_days}</dd>
                    {b && (
                      <>
                        <dt>{categoryLabel(l.category)} left</dt>
                        <dd className={b.remaining < 0 ? 'la-neg' : undefined}>{b.remaining} of {b.allowance} in {year} (after this request)</dd>
                      </>
                    )}
                    {l.replacement_name && (
                      <>
                        <dt>Replacement</dt>
                        <dd>{l.replacement_name}</dd>
                      </>
                    )}
                    {l.approver_name && (
                      <>
                        <dt>Asked</dt>
                        <dd>{l.approver_name}</dd>
                      </>
                    )}
                    {l.comment && (
                      <>
                        <dt>Comment</dt>
                        <dd>{l.comment}</dd>
                      </>
                    )}
                    <dt>Requested</dt>
                    <dd>{longDate(l.created_at.slice(0, 10))}</dd>
                  </dl>
                  <div className="la-leave-actions">
                    <PillButton size="sm" icon={Check} onClick={() => approve(l)} disabled={busyId === l.id}>
                      {busyId === l.id ? 'Approving…' : 'Approve'}
                    </PillButton>
                    <PillButton variant="danger" size="sm" icon={X} onClick={() => setRejecting(l)} disabled={busyId === l.id}>
                      Reject
                    </PillButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>

      {rejecting && <DecideModal leave={rejecting} decision="rejected" onClose={() => setRejecting(null)} onDone={reload} />}
    </>
  );
}
