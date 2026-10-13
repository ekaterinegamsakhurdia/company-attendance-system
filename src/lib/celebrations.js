// Birthdays, work anniversaries and the numbers behind the CEO analytics.
import { daysBetween, daysInMonth, isLeapYear, parseYmd, ymd } from './calendar.js';

/**
 * The date in `year` on which a yearly date is celebrated. 29 February is celebrated on
 * 28 February in years that have no 29 February.
 */
export function celebrationDate(value, year) {
  const p = parseYmd(value);
  if (!p) return null;
  const day = p.m === 2 && p.d === 29 && !isLeapYear(year) ? 28 : p.d;
  return ymd(year, p.m, day);
}

/** The next celebration on or after `today`: { date, daysUntil }. */
export function nextOccurrence(value, today) {
  const { y } = parseYmd(today);
  let date = celebrationDate(value, y);
  if (date < today) date = celebrationDate(value, y + 1);
  return { date, daysUntil: daysBetween(today, date) };
}

/** Full years between two dates (a birthday / anniversary counts on its celebration date). */
export function fullYears(from, to) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  let years = b.y - a.y;
  if (to < celebrationDate(from, b.y)) years -= 1;
  return years;
}

/** 'N years M months' style text for a length of service. */
export function serviceText(hire, today) {
  if (!hire || hire > today) return '-';
  const a = parseYmd(hire);
  const b = parseYmd(today);
  let months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years ? `${years} ${years === 1 ? 'year' : 'years'}` : '';
  const m = rest || !years ? `${rest} ${rest === 1 ? 'month' : 'months'}` : '';
  return [y, m].filter(Boolean).join(' ');
}

/** '1 year 7 months 24 days' - the exact length of service up to `today`. */
export function serviceDetailed(hire, today) {
  if (!hire || hire > today) return '-';
  const a = parseYmd(hire);
  const b = parseYmd(today);
  let months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
  if (months < 0) months = 0;
  const total = a.y * 12 + (a.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const anchor = ymd(y, m, Math.min(a.d, daysInMonth(y, m)));
  const days = daysBetween(anchor, today);
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (Math.floor(months / 12)) parts.push(unit(Math.floor(months / 12), 'year'));
  if (months % 12) parts.push(unit(months % 12, 'month'));
  if (days || parts.length === 0) parts.push(unit(days, 'day'));
  return parts.join(' ');
}

const fullName = (e) => `${e.first_name} ${e.last_name}`;

/** profiles: [{ employee_id, birth_date, hire_date }] -> Map by employee id */
export function profileMap(profiles) {
  return new Map((profiles ?? []).map((p) => [p.employee_id, p]));
}

/**
 * Upcoming birthdays or anniversaries, soonest first.
 * kind: 'birthday' | 'anniversary'. Only active accounts are listed.
 * Returns [{ employee, name, date, daysUntil, years }] where `years` is the age turned
 * (birthday) or the number of years completed (anniversary).
 * Anniversaries start after the first full year.
 */
export function upcomingCelebrations({ employees, profiles, kind, today, withinDays = 366 }) {
  const byId = profileMap(profiles);
  const out = [];
  for (const e of employees) {
    if (!e.is_active) continue;
    const source = kind === 'birthday' ? byId.get(e.id)?.birth_date : byId.get(e.id)?.hire_date;
    if (!source || (kind === 'anniversary' && source > today)) continue;
    const { date, daysUntil } = nextOccurrence(source, today);
    if (daysUntil > withinDays) continue;
    const years = parseYmd(date).y - parseYmd(source).y;
    if (kind === 'anniversary' && years < 1) continue;
    out.push({ employee: e, name: fullName(e), date, daysUntil, years });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}

/**
 * Calendar events for birthdays and anniversaries that fall in [from, to].
 * Returns [{ id, kind, start, title, employeeId, years }].
 */
export function celebrationEvents({ employees, profiles, from, to }) {
  const byId = profileMap(profiles);
  const startYear = parseYmd(from).y;
  const endYear = parseYmd(to).y;
  const events = [];
  for (const e of employees) {
    if (!e.is_active) continue;
    const p = byId.get(e.id);
    if (!p) continue;
    for (let year = startYear; year <= endYear; year += 1) {
      if (p.birth_date) {
        const date = celebrationDate(p.birth_date, year);
        if (date >= from && date <= to && year >= parseYmd(p.birth_date).y) {
          events.push({ id: `b-${e.id}-${year}`, kind: 'birthday', start: date, title: `${fullName(e)} - birthday`, employeeId: e.id, years: year - parseYmd(p.birth_date).y });
        }
      }
      if (p.hire_date) {
        const date = celebrationDate(p.hire_date, year);
        const years = year - parseYmd(p.hire_date).y;
        if (date >= from && date <= to && years >= 1) {
          events.push({ id: `a-${e.id}-${year}`, kind: 'anniversary', start: date, title: `${fullName(e)} - ${years} ${years === 1 ? 'year' : 'years'} at the company`, employeeId: e.id, years });
        }
      }
    }
  }
  return events;
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Average age in years (one decimal) over people with a birth date, or null. */
export function averageAge({ employees, profiles, today }) {
  const byId = profileMap(profiles);
  const ages = employees
    .filter((e) => e.is_active && byId.get(e.id)?.birth_date && byId.get(e.id).birth_date <= today)
    .map((e) => daysBetween(byId.get(e.id).birth_date, today) / 365.25);
  if (ages.length === 0) return { value: null, counted: 0 };
  return { value: round1(ages.reduce((s, x) => s + x, 0) / ages.length), counted: ages.length };
}

/** Average length of service in years (one decimal) over people with a hire date, or null. */
export function averageService({ employees, profiles, today }) {
  const byId = profileMap(profiles);
  const spans = employees
    .filter((e) => e.is_active && byId.get(e.id)?.hire_date && byId.get(e.id).hire_date <= today)
    .map((e) => daysBetween(byId.get(e.id).hire_date, today) / 365.25);
  if (spans.length === 0) return { value: null, counted: 0 };
  return { value: round1(spans.reduce((s, x) => s + x, 0) / spans.length), counted: spans.length };
}

/** Active accounts, in total and per department name ('No department' for CEOs / developers). */
export function teamCount({ employees, departments }) {
  const active = employees.filter((e) => e.is_active);
  const names = new Map(departments.map((d) => [d.id, d.name]));
  const byDept = new Map();
  for (const e of active) {
    const name = e.department_id ? names.get(e.department_id) ?? 'Unknown' : 'No department';
    byDept.set(name, (byDept.get(name) ?? 0) + 1);
  }
  return {
    total: active.length,
    byDepartment: [...byDept.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** Active people without a birth or hire date (so the CEO knows what is missing). */
export function missingDates({ employees, profiles }) {
  const byId = profileMap(profiles);
  return employees
    .filter((e) => e.is_active)
    .map((e) => ({ employee: e, birth: !byId.get(e.id)?.birth_date, hire: !byId.get(e.id)?.hire_date }))
    .filter((x) => x.birth || x.hire);
}
