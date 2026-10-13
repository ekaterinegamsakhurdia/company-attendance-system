// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings and all arithmetic is done in UTC,
// so the result never depends on the browser's time zone or daylight saving.

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n, width = 2) => String(n).padStart(width, '0');

export function parseYmd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function ymd(y, m, d) {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

const toUtc = (s) => {
  const p = parseYmd(s);
  return Date.UTC(p.y, p.m - 1, p.d);
};

const fromUtc = (ms) => {
  const d = new Date(ms);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

export function addDays(value, n) {
  return fromUtc(toUtc(value) + n * 86400000);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(value) {
  return (new Date(toUtc(value)).getUTCDay() + 6) % 7;
}

export const isWeekend = (value) => weekdayIndex(value) >= 5;

export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** { year, month } moved by `delta` months (month is 1-12). */
export function shiftMonth(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Monday-first grid for the month: array of weeks, each 7 { date, inMonth }. */
export function monthGrid(year, month) {
  const first = ymd(year, month, 1);
  const start = addDays(first, -weekdayIndex(first));
  const lastDay = ymd(year, month, daysInMonth(year, month));
  const weeks = [];
  let cursor = start;
  while (cursor <= lastDay || weeks.length < 4) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      const p = parseYmd(cursor);
      week.push({ date: cursor, inMonth: p.y === year && p.m === month });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
    if (cursor > lastDay && weeks.length >= 4) break;
  }
  return weeks;
}

export function eachDay(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Spreads events over the days they cover, limited to [from, to].
 * Each event needs `start` and (optionally) `end` ('YYYY-MM-DD'). Returns Map<date, event[]>.
 */
export function eventsByDay(events, from, to) {
  const map = new Map();
  for (const ev of events) {
    const end = ev.end ?? ev.start;
    const first = ev.start < from ? from : ev.start;
    const last = end > to ? to : end;
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(ev);
    }
  }
  return map;
}

/** '3 Mar 2026' */
export function longDate(value) {
  const p = parseYmd(value);
  if (!p) return '-';
  return `${p.d} ${MONTH_NAMES[p.m - 1].slice(0, 3)} ${p.y}`;
}

/** '3 Mar' */
export function shortDate(value) {
  const p = parseYmd(value);
  if (!p) return '-';
  return `${p.d} ${MONTH_NAMES[p.m - 1].slice(0, 3)}`;
}

/** '3 Mar - 7 Mar 2026', or a single date when start == end. */
export function dateRange(start, end) {
  if (!end || start === end) return longDate(start);
  const a = parseYmd(start);
  const b = parseYmd(end);
  if (a.y === b.y) return `${shortDate(start)} - ${longDate(end)}`;
  return `${longDate(start)} - ${longDate(end)}`;
}

/** Last day of the month containing `value`. */
export function monthEnd(value) {
  const p = parseYmd(value);
  return ymd(p.y, p.m, daysInMonth(p.y, p.m));
}

/**
 * Moves a date range one step. A whole calendar month moves by whole months,
 * anything else by its own length. direction is -1 or 1.
 */
export function shiftRange(from, to, direction) {
  const f = parseYmd(from);
  if (from === ymd(f.y, f.m, 1) && to === monthEnd(from)) {
    const next = shiftMonth(f.y, f.m, direction);
    const start = ymd(next.year, next.month, 1);
    return { from: start, to: monthEnd(start) };
  }
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, direction * length), to: addDays(to, direction * length) };
}
