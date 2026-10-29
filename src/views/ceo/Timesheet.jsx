import { useMemo, useState } from 'react';
import { ArrowUpDown, Download, Table2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import PersonLink from '../../components/PersonLink';
import { Alert, Message, PillButton, SectionCard } from '../../components/ui';
import { fetchAttendanceRange, listHolidays, listLeaves } from '../../services/api';
import { downloadCsv, toCsv } from '../../lib/csv';
import { daysBetween, MONTH_NAMES } from '../../lib/calendar';
import { CATEGORIES, categoryLabel } from '../../lib/leaves';
import { buildDays, buildTimesheet, cellTitle, companyHours, formatHours, sortRows } from '../../lib/timesheet';
import { todayInTz } from '../../lib/time';

const MAX_DAYS = 93;
const LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, categoryLabel(c.id)]));
const LEAVE_CLASS = { vacation: 'leave-v', unpaid: 'leave-ul', day_off: 'leave-do' };

function cellClass(cell) {
  if (cell.kind === 'leave') return LEAVE_CLASS[cell.leave.category] ?? 'leave-v';
  return `${cell.kind}${cell.open ? ' open' : ''}${cell.online ? ' online' : ''}${cell.overtimeMinutes > 0 ? ' ot' : ''}`;
}

/**
 * The monthly timesheet: a row per person, a column per day, hours in the cells,
 * and the days of vacation (V), unpaid leave (UL) and day off (DO) at the end.
 * `people` are already filtered; `profiles` is a Map (CEOs / developers only, else empty).
 */
export default function Timesheet({ people, range, leaveTypes, profiles, everyone }) {
  const { timezone, settings } = useAuth();
  const today = todayInTz(timezone);
  const [direction, setDirection] = useState(1);
  const { from, to } = range;
  const valid = Boolean(from && to && from <= to) && daysBetween(from, to) < MAX_DAYS;

  const scoped = people.length < everyone;
  const ids = people.map((p) => p.id);
  const attendance = useLoad(
    () => (people.length === 0 ? Promise.resolve([]) : fetchAttendanceRange({ from, to, employeeIds: scoped ? ids : null })),
    [from, to, ids.join(',')],
    { enabled: valid },
  );
  const holidays = useLoad(() => listHolidays({ from, to }), [from, to], { enabled: valid });
  const leaves = useLoad(() => listLeaves('managed', { from, to }), [from, to], { enabled: valid });

  const days = useMemo(() => buildDays(from, to, holidays.data ?? [], today), [from, to, holidays.data, today]);
  const defaultHours = companyHours(settings.work_start_time, settings.work_end_time);

  const rows = useMemo(() => {
    if (!valid || !attendance.data || !leaves.data) return [];
    let list = people;
    if (leaveTypes.length) {
      const has = new Set(leaves.data.filter((l) => (l.status === 'approved' || l.status === 'pending') && leaveTypes.includes(l.category)).map((l) => l.employee_id));
      list = list.filter((p) => has.has(p.id));
    }
    return sortRows(buildTimesheet({ people: list, days, attendance: attendance.data, leaves: leaves.data, profiles, defaultHours, today }), direction);
  }, [valid, people, attendance.data, leaves.data, leaveTypes, days, profiles, defaultHours, today, direction]);

  const months = useMemo(() => {
    const groups = [];
    for (const d of days) {
      const last = groups[groups.length - 1];
      if (last && last.month === d.month) last.span += 1;
      else groups.push({ month: d.month, span: 1 });
    }
    return groups.map((g) => ({ ...g, label: `${MONTH_NAMES[Number(g.month.slice(5)) - 1]} ${g.month.slice(0, 4)}` }));
  }, [days]);

  function exportCsv() {
    const columns = [
      { label: 'Employee #', get: (r) => r.person.employee_number },
      { label: 'Name', get: (r) => `${r.person.first_name} ${r.person.last_name}` },
      ...days.map((d, i) => ({ label: d.date, get: (r) => (r.cells[i].kind === 'na' ? '' : formatHours(r.cells[i].hours)) })),
      { label: 'Hours worked', get: (r) => formatHours(r.totals.hours) },
      { label: 'V (vacation)', get: (r) => r.totals.v },
      { label: 'UL (unpaid leave)', get: (r) => r.totals.ul },
      { label: 'DO (day off)', get: (r) => r.totals.do },
      { label: 'Online days', get: (r) => r.totals.online },
      { label: 'Overtime hours', get: (r) => formatHours(r.totals.overtime) },
    ];
    downloadCsv(`timesheet_${from}_to_${to}.csv`, toCsv(rows, columns));
  }

  const error = attendance.error || holidays.error || leaves.error;
  const loading = (attendance.loading && !attendance.data) || (leaves.loading && !leaves.data);

  return (
    <SectionCard
      icon={Table2}
     
      title="Timesheet"
      action={
        <div className="la-toolbar">
          <PillButton variant="secondary" size="sm" icon={ArrowUpDown} onClick={() => setDirection((d) => -d)} aria-label="Sort by name">
            Name {direction === 1 ? '↑' : '↓'}
          </PillButton>
          <PillButton size="sm" icon={Download} onClick={exportCsv} disabled={rows.length === 0}>
            Download
          </PillButton>
        </div>
      }
    >
      {!valid && <Alert error>Choose a range of at most {MAX_DAYS} days, with &ldquo;From&rdquo; before &ldquo;To&rdquo;.</Alert>}
      {error && <Alert error>{error}</Alert>}
      {valid && (
        <div className="la-ts-legend" aria-label="Legend">
          <span><i className="la-key weekend" />Weekend</span>
          <span><i className="la-key holiday" />Public holiday</span>
          <span><i className="la-key leave-v" />Vacation</span>
          <span><i className="la-key leave-ul" />Unpaid leave</span>
          <span><i className="la-key leave-do" />Day off</span>
          <span><i className="la-key pending" />Requested</span>
          <span><i className="la-key online" />Online work day</span>
          <span><i className="la-key ot-dot" />Overtime (dot)</span>
          <span><i className="la-key absent" />No record</span>
          <span>Grey numbers are scheduled hours (today and later); other numbers are hours worked.</span>
        </div>
      )}
      {valid && loading ? (
        <Message>Loading…</Message>
      ) : valid && rows.length === 0 ? (
        <Message>Nobody matches these filters.</Message>
      ) : (
        valid && (
          <div className="la-ts-wrap">
            <table className="la-ts" aria-label="Timesheet">
              <thead>
                <tr className="la-ts-months">
                  <th className="la-ts-name" scope="col">{months.length === 1 ? months[0].label : 'Name'}</th>
                  {months.map((m) => (
                    <th key={m.month} colSpan={m.span} scope="colgroup">{months.length === 1 ? '' : m.label}</th>
                  ))}
                  <th className="la-ts-sum" colSpan={6} scope="colgroup" />
                </tr>
                <tr className="la-ts-days">
                  <th className="la-ts-name" scope="col"><span className="la-sr">Employee</span></th>
                  {days.map((d) => (
                    <th
                      key={d.date}
                      scope="col"
                      className={`${d.today ? 'today' : ''} ${d.weekend ? 'weekend' : ''} ${d.holiday ? 'holiday' : ''}`}
                      title={d.holiday ? `Public holiday: ${d.holiday}` : undefined}
                      aria-label={`${d.date}${d.today ? ' (today)' : ''}`}
                    >
                      <div>{d.weekday}</div>
                      <div>{d.day}</div>
                    </th>
                  ))}
                  <th className="la-ts-sum" scope="col" title="Hours worked">Hrs</th>
                  <th className="la-ts-sum" scope="col" title="Vacation days">V<div><i className="la-ts-key v" /></div></th>
                  <th className="la-ts-sum" scope="col" title="Unpaid leave days">UL<div><i className="la-ts-key ul" /></div></th>
                  <th className="la-ts-sum" scope="col" title="Days off">DO<div><i className="la-ts-key do" /></div></th>
                  <th className="la-ts-sum" scope="col" title="Online work days">ON<div><i className="la-ts-key on" /></div></th>
                  <th className="la-ts-sum" scope="col" title="Overtime hours">OT<div><i className="la-ts-key ot" /></div></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.person.id}>
                    <th className="la-ts-name" scope="row">
                      <PersonLink id={r.person.id}>{r.person.first_name} {r.person.last_name}</PersonLink>
                    </th>
                    {r.cells.map((c, i) => (
                      <td key={days[i].date} className={cellClass(c)} title={cellTitle(c, days[i], LABELS)}>
                        {c.kind === 'na' ? '–' : formatHours(c.hours)}
                      </td>
                    ))}
                    <td className="la-ts-sum">{formatHours(r.totals.hours)}</td>
                    <td className="la-ts-sum">{r.totals.v}</td>
                    <td className="la-ts-sum">{r.totals.ul}</td>
                    <td className="la-ts-sum">{r.totals.do}</td>
                    <td className="la-ts-sum">{r.totals.online}</td>
                    <td className="la-ts-sum">{formatHours(r.totals.overtime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </SectionCard>
  );
}
