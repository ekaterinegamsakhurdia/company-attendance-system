import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLoad } from '../hooks/useLoad';
import PersonLink from './PersonLink';
import { Alert, Message, PillButton } from './ui';
import { listDepartments, listEmployees, listHolidays, listLeaves } from '../services/api';
import { MONTH_NAMES, daysInMonth, longDate, parseYmd, shiftMonth, ymd } from '../lib/calendar';
import { categoryLabel } from '../lib/leaves';
import { buildDays, buildLeaveGrid, groupByDepartment } from '../lib/leaveGrid';

const LEGEND = [
  { kind: 'vacation', label: 'Vacation' },
  { kind: 'unpaid', label: 'Unpaid leave' },
  { kind: 'day_off', label: 'Day off' },
  { kind: 'holiday', label: 'Public holiday' },
];

function cellText(person, cell) {
  const who = `${person.first_name} ${person.last_name}`;
  const date = longDate(cell.date);
  if (cell.kind === 'holiday') return `${who}, ${date}: public holiday (${cell.title})`;
  if (cell.leave) {
    const range = cell.leave.start_date === cell.leave.end_date ? '' : ` (${longDate(cell.leave.start_date)} to ${longDate(cell.leave.end_date)})`;
    return `${who}, ${date}: ${categoryLabel(cell.kind)}${range}${cell.pending ? ', waiting for approval' : ''}`;
  }
  return null;
}

/**
 * The team grid: dates across, people down, one coloured square per leave day.
 * Managers only: a CEO / developer sees everybody, a department head their own department
 * (the database decides who is returned). Pass `directory` to reuse the already loaded people.
 */
export default function TeamGrid({ year, month, onMonth, today, directory, departmentId }) {
  const from = ymd(year, month, 1);
  const to = ymd(year, month, daysInMonth(year, month));

  const ownEmployees = useLoad(listEmployees, [], { enabled: !directory });
  const ownDepartments = useLoad(listDepartments, [], { enabled: !directory });
  const holidays = useLoad(() => listHolidays({ from, to }), [from, to]);
  const leaves = useLoad(() => listLeaves('managed', { from, to }), [from, to]);

  const employees = directory?.employees ?? ownEmployees.data ?? [];
  const departments = directory?.departments ?? ownDepartments.data ?? [];

  const days = useMemo(() => buildDays(from, to, holidays.data ?? [], today), [from, to, holidays.data, today]);
  const groups = useMemo(() => {
    const people = employees.filter((e) => e.is_active && (!departmentId || e.department_id === departmentId));
    return groupByDepartment(buildLeaveGrid({ people, days, leaves: leaves.data ?? [] }), departments);
  }, [employees, departments, departmentId, days, leaves.data]);

  const error = holidays.error || leaves.error || ownEmployees.error || ownDepartments.error;
  const loading = holidays.loading || leaves.loading || ownEmployees.loading;
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  const go = (delta) => {
    const next = shiftMonth(year, month, delta);
    onMonth(next.year, next.month);
  };
  const goToday = () => {
    const p = parseYmd(today);
    onMonth(p.y, p.m);
  };

  return (
    <div className="la-tg">
      <div className="la-cal-head">
        <PillButton variant="secondary" size="sm" icon={ChevronLeft} onClick={() => go(-1)} aria-label="Previous month">
          <span className="la-sr">Previous month</span>
        </PillButton>
        <h3 className="la-cal-title" aria-live="polite">
          {MONTH_NAMES[month - 1]} {year}
        </h3>
        <PillButton variant="secondary" size="sm" icon={ChevronRight} onClick={() => go(1)} aria-label="Next month">
          <span className="la-sr">Next month</span>
        </PillButton>
        <PillButton variant="ghost" size="sm" onClick={goToday}>
          Today
        </PillButton>
      </div>

      <div className="la-cal-legend" aria-label="Legend">
        {LEGEND.map((l) => (
          <span key={l.kind} className="la-cal-legend-item">
            <i className={`la-tg-sq ${l.kind}`} aria-hidden="true" /> {l.label}
          </span>
        ))}
        <span className="la-cal-legend-item">
          <i className="la-tg-sq vacation pending" aria-hidden="true" /> Striped: waiting for approval
        </span>
      </div>

      {error && <Alert error>{error}</Alert>}
      {loading && count === 0 && <Message>Loading…</Message>}
      {!loading && count === 0 && !error && <Message>No people to show.</Message>}

      {count > 0 && (
        <div className="la-ts-wrap la-tg-wrap">
          <table className="la-ts la-tg-table" aria-label={`Leave grid, ${MONTH_NAMES[month - 1]} ${year}`}>
            <thead>
              <tr className="la-tg-days">
                <th className="la-ts-name" scope="col">Employee</th>
                {days.map((d) => (
                  <th
                    key={d.date}
                    scope="col"
                    className={[d.weekend ? 'weekend' : '', d.holiday ? 'holiday' : '', d.today ? 'today' : ''].join(' ')}
                    title={`${longDate(d.date)}${d.holiday ? `: ${d.holiday}` : ''}`}
                  >
                    <span className="la-tg-wd">{d.weekday}</span>
                    <span className="la-tg-dn">{d.day}</span>
                  </th>
                ))}
                <th className="la-ts-sum" scope="col" title="Vacation days this month">V</th>
                <th className="la-ts-sum" scope="col" title="Unpaid leave days this month">UL</th>
                <th className="la-ts-sum" scope="col" title="Days off this month">DO</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.id || 'leadership'}>
                <tr className="la-tg-group">
                  <th className="la-ts-name" scope="rowgroup" colSpan={1}>
                    {g.name} <span className="la-tg-count">{g.rows.length}</span>
                  </th>
                  <td colSpan={days.length + 3} />
                </tr>
                {g.rows.map((row) => (
                  <tr key={row.person.id}>
                    <th className="la-ts-name" scope="row">
                      <PersonLink id={row.person.id}>
                        {row.person.first_name} {row.person.last_name}
                      </PersonLink>
                    </th>
                    {row.cells.map((cell, i) => {
                      const text = cellText(row.person, cell);
                      const d = days[i];
                      return (
                        <td key={cell.date} className={[d.weekend ? 'weekend' : '', d.today ? 'today' : ''].join(' ')} title={text ?? undefined}>
                          {(cell.kind === 'vacation' || cell.kind === 'unpaid' || cell.kind === 'day_off' || cell.kind === 'holiday') && (
                            <span
                              className={`la-tg-sq ${cell.kind}${cell.pending ? ' pending' : ''}`}
                              role="img"
                              aria-label={text}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="la-ts-sum">{row.totals.vacation || ''}</td>
                    <td className="la-ts-sum">{row.totals.unpaid || ''}</td>
                    <td className="la-ts-sum">{row.totals.day_off || ''}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <p className="la-meta">Weekends and public holidays inside a leave are not leave days, so they are not coloured as leave. The totals count approved days only.</p>
    </div>
  );
}
