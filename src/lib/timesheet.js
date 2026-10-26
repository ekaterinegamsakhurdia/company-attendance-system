// The monthly timesheet grid: one row per person, one column per day.
import { eachDay, isWeekend, weekdayIndex, WEEKDAY_SHORT } from './calendar.js';

/** 7.5 -> '7.5', 8 -> '8', 0 -> '0' */
export function formatHours(hours) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '';
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** The company work day in hours, from 'HH:MM[:SS]' start and end times (8 when unknown). */
export function companyHours(start, end) {
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a === null || b === null || b <= a) return 8;
  return Math.round(((b - a) / 60) * 100) / 100;
}

/** Hours a person is expected to work on a working day. */
export const scheduledHours = (profile, fallback) => (profile?.daily_hours ? Number(profile.daily_hours) : fallback);

/** The columns of the grid. */
export function buildDays(from, to, holidays, today) {
  const holidayNames = new Map();
  for (const h of holidays) holidayNames.set(h.holiday_date, [...(holidayNames.get(h.holiday_date) ?? []), h.name]);
  return eachDay(from, to).map((date) => ({
    date,
    weekday: WEEKDAY_SHORT[weekdayIndex(date)].slice(0, 2),
    day: Number(date.slice(8)),
    month: date.slice(0, 7),
    weekend: isWeekend(date),
    holiday: holidayNames.has(date) ? holidayNames.get(date).join(', ') : null,
    today: date === today,
  }));
}

/**
 * One row per person.
 * cell kinds: 'worked' (an attendance record), 'leave' (approved), 'pending' (requested),
 * 'holiday', 'weekend', 'absent' (a past working day with nothing), 'planned' (today or later),
 * 'na' (before the person's start date).
 * Totals: v / ul / do = approved leave working days by type, hours = hours actually worked.
 */
export function buildTimesheet({ people, days, attendance, leaves, profiles = new Map(), defaultHours = 8, today, nowMs = Date.now() }) {
  const att = new Map();
  for (const r of attendance) if (r.employee_id) att.set(`${r.employee_id}|${r.work_date}`, r);

  const leaveOn = new Map(); // `${employee}|${date}` -> leave (approved beats pending)
  for (const l of leaves) {
    if (l.status !== 'approved' && l.status !== 'pending') continue;
    for (const d of days) {
      if (d.date < l.start_date || d.date > l.end_date) continue;
      const key = `${l.employee_id}|${d.date}`;
      const current = leaveOn.get(key);
      if (!current || (current.status === 'pending' && l.status === 'approved')) leaveOn.set(key, l);
    }
  }

  return people.map((person) => {
    const profile = profiles.get(person.id);
    const planned = scheduledHours(profile, defaultHours);
    const totals = { v: 0, ul: 0, do: 0, hours: 0, online: 0, overtime: 0 };
    const cells = days.map((d) => {
      const rec = att.get(`${person.id}|${d.date}`);
      const leave = leaveOn.get(`${person.id}|${d.date}`);
      const working = !d.weekend && !d.holiday;
      if (leave && leave.status === 'approved' && working) {
        const key = { vacation: 'v', unpaid: 'ul', day_off: 'do' }[leave.category];
        if (key) totals[key] += 1;
      }
      if (rec) {
        const open = !rec.clock_out;
        const hours = rec.worked_minutes != null ? rec.worked_minutes / 60 : open ? Math.max(0, (nowMs - new Date(rec.clock_in).getTime()) / 3600000) : 0;
        totals.hours += hours;
        const online = rec.work_mode === 'online';
        const overtimeMinutes = rec.overtime_minutes ?? 0;
        if (online) totals.online += 1;
        totals.overtime += overtimeMinutes / 60;
        return { kind: 'worked', hours, open, online, overtimeMinutes, leave: leave && working ? leave : null, record: rec };
      }
      if (profile?.hire_date && d.date < profile.hire_date) return { kind: 'na', hours: null };
      if (leave && working) return { kind: leave.status === 'approved' ? 'leave' : 'pending', hours: 0, leave };
      if (d.holiday) return { kind: 'holiday', hours: 0 };
      if (d.weekend) return { kind: 'weekend', hours: 0 };
      return d.date < today ? { kind: 'absent', hours: 0 } : { kind: 'planned', hours: planned };
    });
    return { person, cells, totals };
  });
}

/** Text for the tooltip of one cell. */
export function cellTitle(cell, day, labels = {}) {
  const lines = [];
  if (day.holiday) lines.push(`Public holiday: ${day.holiday}`);
  if (cell.kind === 'worked') lines.push(cell.open ? 'Still clocked in' : `Worked ${formatHours(cell.hours)} h`);
  if (cell.online) lines.push('Online work day');
  if (cell.overtimeMinutes > 0) lines.push(`Overtime ${formatHours(cell.overtimeMinutes / 60)} h`);
  if (cell.leave) lines.push(`${labels[cell.leave.category] ?? cell.leave.category} (${cell.leave.status})`);
  if (cell.kind === 'weekend') lines.push('Weekend');
  if (cell.kind === 'absent') lines.push('No attendance record');
  if (cell.kind === 'planned') lines.push('Scheduled');
  if (cell.kind === 'na') lines.push('Before the start date');
  return lines.join(' · ');
}

/** Sort rows by name, ascending or descending. */
export function sortRows(rows, direction = 1) {
  return [...rows].sort(
    (a, b) => direction * `${a.person.first_name} ${a.person.last_name}`.localeCompare(`${b.person.first_name} ${b.person.last_name}`),
  );
}
