import { Pill, PillButton } from './ui';
import { dateRange, longDate } from '../lib/calendar';
import { categoryLabel, statusLabel, statusTone } from '../lib/leaves';
import { formatDateTime } from '../lib/time';

/** One leave request as a card (used on "My leaves"). */
export default function LeaveCard({ leave, timezone, onCancel, busy }) {
  const decided = leave.status === 'approved' || leave.status === 'rejected';
  const dim = leave.status === 'rejected' || leave.status === 'cancelled';
  return (
    <article className={`la-leave-card${dim ? ' dim' : ''}`} aria-label={`${categoryLabel(leave.category)} ${dateRange(leave.start_date, leave.end_date)}`}>
      <div className="la-leave-top">
        <Pill>{categoryLabel(leave.category)}</Pill>
        <Pill tone={statusTone(leave.status)}>{statusLabel(leave.status)}</Pill>
      </div>
      <div className="la-leave-dates">{dateRange(leave.start_date, leave.end_date)}</div>
      <dl className="la-leave-facts">
        <dt>Working days</dt>
        <dd>{leave.working_days}</dd>
        {leave.approver_name && (
          <>
            <dt>Approver</dt>
            <dd>{leave.approver_name}</dd>
          </>
        )}
        {leave.replacement_name && (
          <>
            <dt>Replacement</dt>
            <dd>{leave.replacement_name}</dd>
          </>
        )}
        {leave.comment && (
          <>
            <dt>Comment</dt>
            <dd>{leave.comment}</dd>
          </>
        )}
        {decided && leave.decided_by_name && (
          <>
            <dt>{leave.status === 'approved' ? 'Approved by' : 'Rejected by'}</dt>
            <dd>
              {leave.decided_by_name}
              {leave.decided_at ? ` · ${formatDateTime(leave.decided_at, timezone)}` : ''}
            </dd>
          </>
        )}
        {leave.status === 'cancelled' && leave.decided_by_name && (
          <>
            <dt>Cancelled by</dt>
            <dd>{leave.decided_by_name}</dd>
          </>
        )}
        {leave.decision_comment && (
          <>
            <dt>Note</dt>
            <dd>{leave.decision_comment}</dd>
          </>
        )}
        <dt>Requested</dt>
        <dd>{longDate(leave.created_at.slice(0, 10))}</dd>
      </dl>
      {onCancel && (
        <div className="la-leave-actions">
          <PillButton variant="danger" size="sm" onClick={() => onCancel(leave)} disabled={busy}>
            Cancel request
          </PillButton>
        </div>
      )}
    </article>
  );
}
