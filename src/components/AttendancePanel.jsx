import { CalendarDays, Clock, Fingerprint, ListChecks, LogIn, LogOut, Timer, UserCheck, Wifi, WifiOff } from 'lucide-react';
import { Alert, DataTable, FeatureTile, Message, Pill, PillButton, SectionCard } from './ui';
import { formatDate, formatTime, formatWorked, todayInTz } from '../lib/time';

/** "Today's attendance" card with the clock-in / clock-out button. */
export function AttendancePanel({
  record,
  timezone,
  busy,
  onClockIn,
  onClockOut,
  requireNetwork = false,
  network = null,
  onRecheckNetwork,
  requireBiometric = false,
}) {
  const open = record && !record.clock_out;
  const done = record && record.clock_out;

  // `network` is null while unknown; the server enforces the rule either way.
  const offNetwork = requireNetwork && network && !network.on_company_network;
  const blocked = busy || offNetwork;
  const suffix = requireBiometric ? ' with Face ID / fingerprint' : '';

  return (
    <SectionCard icon={Clock} eyebrow="Attendance" title="My Attendance Today">
      <div className="la-grid">
        <FeatureTile icon={CalendarDays}>
          <strong>Date:</strong> {formatDate(todayInTz(timezone))}
        </FeatureTile>
        <FeatureTile icon={LogIn}>
          <strong>Clock In:</strong> {record ? formatTime(record.clock_in, timezone) : '-'}
        </FeatureTile>
        <FeatureTile icon={LogOut}>
          <strong>Clock Out:</strong> {record ? formatTime(record.clock_out, timezone) : '-'}
        </FeatureTile>
        <FeatureTile icon={Timer}>
          <strong>Worked:</strong> {record ? formatWorked(record.worked_minutes) : '-'}
        </FeatureTile>
        {record?.clockout_type && (
          <FeatureTile icon={UserCheck}>
            <strong>Clock Out Type:</strong> {record.clockout_type === 'automatic' ? 'Automatic' : 'Manual'}
          </FeatureTile>
        )}
      </div>

      {requireNetwork && network && (
        <div className="la-toolbar" style={{ alignItems: 'center' }}>
          {network.on_company_network ? (
            <Pill tone="ok">
              <Wifi size={12} aria-hidden="true" /> On company network
            </Pill>
          ) : (
            <Pill tone="warn">
              <WifiOff size={12} aria-hidden="true" /> Not on company network
            </Pill>
          )}
          {requireBiometric && (
            <Pill>
              <Fingerprint size={12} aria-hidden="true" /> Face ID / fingerprint required
            </Pill>
          )}
        </div>
      )}
      {offNetwork && !done && (
        <Alert error>
          You are not connected to the company wifi, so you cannot clock in or out right now. You can still log in and
          view your history from anywhere.
          {onRecheckNetwork && (
            <>
              {' '}
              <button type="button" className="la-link" onClick={onRecheckNetwork}>
                Check again
              </button>
            </>
          )}
        </Alert>
      )}

      {!record && (
        <PillButton block icon={requireBiometric ? Fingerprint : LogIn} onClick={onClockIn} disabled={blocked}>
          {busy ? 'Clocking In…' : `Clock In${suffix}`}
        </PillButton>
      )}
      {open && (
        <PillButton variant="secondary" block icon={requireBiometric ? Fingerprint : LogOut} onClick={onClockOut} disabled={blocked}>
          {busy ? 'Clocking Out…' : `Clock Out${suffix}`}
        </PillButton>
      )}
      {done && <Alert success>You have completed today's attendance.</Alert>}
    </SectionCard>
  );
}

export function HistoryCard({ rows, loading, timezone, title = 'Attendance History' }) {
  return (
    <SectionCard icon={ListChecks} eyebrow="Last 30 records" title={title}>
      {loading ? (
        <Message>Loading attendance history…</Message>
      ) : rows.length === 0 ? (
        <Message>No attendance records yet.</Message>
      ) : (
        <DataTable headers={['Date', 'Clock In', 'Clock Out', 'Worked']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="la-td">{formatDate(r.work_date)}</td>
              <td className="la-td">{formatTime(r.clock_in, timezone)}</td>
              <td className="la-td">
                {r.clock_out
                  ? `${formatTime(r.clock_out, timezone)}${r.clockout_type === 'automatic' ? ' (auto)' : ''}`
                  : 'Still working'}
              </td>
              <td className="la-td">{formatWorked(r.worked_minutes)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </SectionCard>
  );
}
