import { useMemo, useState } from 'react';
import { useProfileCard } from '../hooks/useProfileCard';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import MonthCalendar from '../components/MonthCalendar';
import TeamGrid from '../components/TeamGrid';
import { Alert, Field, SectionCard } from '../components/ui';
import { fetchOnlineDays, listHolidays, listLeaves, listProfiles } from '../services/api';
import { categoryLabel } from '../lib/leaves';
import { celebrationEvents } from '../lib/celebrations';
import { monthGrid, parseYmd } from '../lib/calendar';
import { todayInTz } from '../lib/time';

const LAYERS = [
  { id: 'holiday', label: 'Public holidays' },
  { id: 'leave', label: 'Approved leaves' },
  { id: 'pending', label: 'Pending leaves' },
  { id: 'birthday', label: 'Birthdays', adminOnly: true },
  { id: 'anniversary', label: 'Work anniversaries', adminOnly: true },
  { id: 'online', label: 'Online work days' },
];

/**
 * One calendar for everybody.
 *  - employee: public holidays + own leaves + own online work days
 *  - department head: + the leaves and online days of the department
 *  - CEO / developer: + everyone's leaves, online days, birthdays and work anniversaries
 */
export default function CalendarView({ directory, title = 'Calendar' }) {
  const { employee, headDepartment, timezone } = useAuth();
  const today = todayInTz(timezone);
  const start = parseYmd(today);
  const isAdmin = employee.role === 'ceo' || employee.role === 'developer';
  const isManager = isAdmin || Boolean(headDepartment);

  const [view, setView] = useState({ year: start.y, month: start.m });
  const [layers, setLayers] = useState(() => new Set(LAYERS.map((l) => l.id)));
  const [departmentId, setDepartmentId] = useState('');
  const [mode, setMode] = useState('month'); // 'month' | 'grid' (the grid is for managers)
  const grid = isManager && mode === 'grid';

  const weeks = useMemo(() => monthGrid(view.year, view.month), [view.year, view.month]);
  const from = weeks[0][0].date;
  const to = weeks[weeks.length - 1][6].date;

  const holidays = useLoad(() => listHolidays({ from, to }), [from, to]);
  const leaves = useLoad(() => listLeaves(isManager ? 'managed' : 'mine', { from, to }), [from, to, isManager]);
  const online = useLoad(() => fetchOnlineDays({ from, to }), [from, to]);
  const card = useProfileCard();
  const profiles = useLoad(listProfiles, [card?.version], { enabled: isAdmin });

  const employees = directory?.employees ?? [];
  const inDepartment = (id) => !departmentId || employees.find((e) => e.id === id)?.department_id === departmentId;

  const events = useMemo(() => {
    const list = [];
    for (const h of holidays.data ?? []) {
      list.push({ id: `h-${h.id}`, kind: 'holiday', start: h.holiday_date, title: h.name });
    }
    for (const l of leaves.data ?? []) {
      if (l.status !== 'approved' && l.status !== 'pending') continue;
      if (isAdmin && departmentId && l.department_id !== departmentId) continue;
      const mine = l.employee_id === employee.id;
      const who = isManager && !mine ? l.employee_name : null;
      list.push({
        id: `l-${l.id}`,
        kind: l.status === 'approved' ? 'leave' : 'pending',
        start: l.start_date,
        end: l.end_date,
        title: who ? `${who} - ${categoryLabel(l.category)}` : categoryLabel(l.category),
        subtitle: [l.status === 'pending' ? 'waiting for approval' : null, l.replacement_name ? `replaced by ${l.replacement_name}` : null]
          .filter(Boolean)
          .join(', '),
      });
    }
    for (const o of online.data ?? []) {
      if (isAdmin && departmentId && employees.find((e) => e.id === o.employee_id)?.department_id !== departmentId) continue;
      const mine = o.employee_id === employee.id;
      list.push({
        id: `o-${o.id}`,
        kind: 'online',
        start: o.work_date,
        title: isManager && !mine ? `${o.employee_name} - online` : 'Working online',
        subtitle: 'from home',
      });
    }
    if (isAdmin && profiles.data) {
      const scoped = employees.filter((e) => inDepartment(e.id));
      list.push(...celebrationEvents({ employees: scoped, profiles: profiles.data, from, to }));
    }
    return list.filter((e) => layers.has(e.kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidays.data, leaves.data, online.data, profiles.data, employees, layers, departmentId, from, to, isAdmin, isManager, employee.id]);

  const toggle = (id) =>
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleLayers = LAYERS.filter((l) => isAdmin || !l.adminOnly);
  const error = grid ? '' : holidays.error || leaves.error || online.error || profiles.error;

  return (
    <SectionCard icon={CalendarDays} eyebrow={isAdmin ? 'Everyone' : isManager ? 'Your department' : 'You'} title={title}>
      <div className="la-toolbar">
        {isManager && (
          <div className="la-seg" role="group" aria-label="Calendar view">
            <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Month</button>
            <button type="button" aria-pressed={mode === 'grid'} onClick={() => setMode('grid')}>Team grid</button>
          </div>
        )}
        {!grid && <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="la-label" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Show</legend>
          <div className="la-checks">
            {visibleLayers.map((l) => (
              <label key={l.id} className="la-check">
                <input type="checkbox" checked={layers.has(l.id)} onChange={() => toggle(l.id)} />
                {l.label}
              </label>
            ))}
          </div>
        </fieldset>}
        {(isAdmin || Boolean(headDepartment?.approves_all_leaves)) && (directory?.departments?.length ?? 0) > 0 && (
          <Field label="Department" id="cal-dept">
            <select id="cal-dept" className="la-input compact" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All departments</option>
              {directory.departments.filter((d) => d.is_active).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {error && <Alert error>{error}</Alert>}
      {grid ? (
        <TeamGrid
          year={view.year}
          month={view.month}
          onMonth={(year, month) => setView({ year, month })}
          today={today}
          directory={directory}
          departmentId={isAdmin ? departmentId : ''}
        />
      ) : (
        <MonthCalendar year={view.year} month={view.month} onMonth={(year, month) => setView({ year, month })} events={events} today={today} />
      )}
    </SectionCard>
  );
}
