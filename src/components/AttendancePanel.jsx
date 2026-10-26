import { useEffect, useState } from 'react';
import { Building2, CalendarDays, Clock, Fingerprint, Home, ListChecks, LogIn, LogOut, MoonStar, Timer, UserCheck, Wifi, WifiOff } from 'lucide-react';
import { Alert, DataTable, FeatureTile, Message, Pill, PillButton, SectionCard } from './ui';
import { formatDate, formatTime, formatWorked, isAtOrAfterTimeInTz, todayInTz } from '../lib/time';

/** "Today's attendance" card with the clock-in / clock-out button. */
export function AttendancePanel({
  record,
  timezone,
  busy,
  onClockIn,
  onClockOut,
  onStartOvertime,
  allowOnline = true,
  workEnd = null,
  requireNetwork = false,
  network = null,
  onRecheckNetwork,
  requireBiometric = false,
}) {
  const open = record && !record.clock_out;
  const done = record && record.clock_out;
  const [online, setOnline] = useState(false); // today's choice, only before clocking in

  // Re-check the time now and then so the overtime button appears by itself after the end of the work day.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const isOnlineDay = record ? record.work_mode === 'online' : online;
  const overtimeRunning = Boolean(record?.overtime_started_at && !record.clock_out);
  const afterEnd = isAtOrAfterTimeInTz(workEnd, timezone);
  // A day at the company can be extended once, after the end time, if it is still open or was closed automatically.
  const canLogOvertime =
    Boolean(record) && record.work_mode !== 'online' && !record.overtime_started_at && afterEnd &&
    (open || record.clockout_type === 'automatic') && Boolean(onStartOvertime);

  // `network` is null while unknown; the server enforces the rule either way.
  // An online day is allowed from anywhere, so the network only matters for office days.
  const offNetwork = requireNetwork && network && !network.on_company_network;
  const blocked = busy || (offNetwork && !isOnlineDay);
  const suffix = requireBiometric ? ' with Face ID / fingerprint' : '';

  return (
    <SectionCard icon={Clock} title="My Attendance Today">
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
        {record && (
          <FeatureTile icon={record.work_mode === 'online' ? Home : Building2}>
            <strong>Working:</strong> {record.work_mode === 'online' ? 'Online (from home)' : 'At the company'}
          </FeatureTile>
        )}
        {record && (record.overtime_started_at || record.overtime_minutes > 0) && (
          <FeatureTile icon={MoonStar}>
            <strong>Overtime:</strong>{' '}
            {overtimeRunning ? `since ${formatTime(record.overtime_started_at, timezone)}` : formatWorked(record.overtime_minutes)}
          </FeatureTile>
        )}
        {record?.clockout_type && (
          <FeatureTile icon={UserCheck}>
            <strong>Clock Out Type:</strong> {record.clockout_type === 'automatic' ? 'Automatic' : 'Manual'}
          </FeatureTile>
        )}
      </div>

      {requireNetwork && network && !isOnlineDay && (
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
      {offNetwork && !done && !isOnlineDay && (
        <Alert error>
          You are not connected to the company wifi, so you cannot clock in or out right now.
          {!record && allowOnline && ' Working from home today? Choose “Online” above.'} You can still log in and view
          your history from anywhere.
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

      {!record && allowOnline && (
        <div className="la-mode" role="group" aria-label="Where are you working today?">
          <span className="la-label">Where are you working today?</span>
          <div className="la-seg">
            <button type="button" aria-pressed={!online} onClick={() => setOnline(false)} disabled={busy}>
              <Building2 size={14} aria-hidden="true" /> At the company
            </button>
            <button type="button" aria-pressed={online} onClick={() => setOnline(true)} disabled={busy}>
              <Home size={14} aria-hidden="true" /> Online
            </button>
          </div>
          {online && (
            <p className="la-meta">
              An online work day: you can clock in from any network. It is marked online in the calendar and in your
              manager's reports.
            </p>
          )}
        </div>
      )}
      {!record && (
        <PillButton block icon={requireBiometric ? Fingerprint : online ? Home : LogIn} onClick={() => onClockIn(online)} disabled={blocked}>
          {busy ? 'Clocking In…' : `${online ? 'Clock In (online)' : 'Clock In'}${suffix}`}
        </PillButton>
      )}
      {open && (
        <PillButton variant="secondary" block icon={requireBiometric ? Fingerprint : LogOut} onClick={onClockOut} disabled={blocked}>
          {busy ? 'Clocking Out…' : `${overtimeRunning ? 'Clock Out and finish overtime' : 'Clock Out'}${suffix}`}
        </PillButton>
      )}
      {canLogOvertime && (
        <div className="la-mode">
          <p className="la-meta">
            {open
              ? 'The work day is over. Staying longer? Log overtime so it is counted and your clock-out time is the real one.'
              : 'You were clocked out automatically at the end of the work day. Still working? Log overtime to continue.'}
          </p>
          <PillButton variant="secondary" block icon={MoonStar} onClick={onStartOvertime} disabled={busy || offNetwork}>
            {busy ? 'Please wait…' : 'Log overtime'}
          </PillButton>
          {offNetwork && <p className="la-meta">Overtime can only be logged on the company wifi.</p>}
        </div>
      )}
      {done && !canLogOvertime && <Alert success>You have completed today's attendance.</Alert>}
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
        <DataTable headers={['Date', 'Clock In', 'Clock Out', 'Worked', 'Notes']}>
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
              <td className="la-td">
                {r.work_mode === 'online' && <Pill tone="online">Online</Pill>}
                {r.overtime_minutes > 0 && <Pill tone="ot">+{formatWorked(r.overtime_minutes)} overtime</Pill>}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </SectionCard>
  );
}
