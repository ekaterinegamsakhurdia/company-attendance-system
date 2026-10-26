// Time helpers. Everything is rendered in the COMPANY time zone (company_settings.timezone),
// never in the browser's, so every device shows the same wall-clock times.

export const FALLBACK_TZ = 'Asia/Tbilisi';

/** 'YYYY-MM-DD' for "today" in the given zone. */
export function todayInTz(tz = FALLBACK_TZ, now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: tz });
}

/** 'YYYY-MM-01' for the first day of the current month in the zone. */
export function monthStartInTz(tz = FALLBACK_TZ, now = new Date()) {
  return `${todayInTz(tz, now).slice(0, 8)}01`;
}

export function formatTime(timestamp, tz = FALLBACK_TZ) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 'YYYY-MM-DD' -> 'DD.MM.YYYY' */
export function formatDate(ymd) {
  if (!ymd) return '-';
  const [year, month, day] = ymd.split('-');
  return `${day}.${month}.${year}`;
}

export function formatDateTime(timestamp, tz = FALLBACK_TZ) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  const date = d.toLocaleDateString('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${date.replaceAll('/', '.')} ${formatTime(timestamp, tz)}`;
}

export function formatWorked(minutes) {
  if (minutes === null || minutes === undefined) return '-';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instant -> value for <input type="datetime-local"> in the company zone ('YYYY-MM-DDTHH:mm'). */
export function toDateTimeLocal(timestamp, tz = FALLBACK_TZ) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const date = d.toLocaleDateString('en-CA', { timeZone: tz });
  const time = d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${date}T${time}`;
}

/** <input type="datetime-local"> value, read as company wall-clock time -> ISO string (UTC). */
export function fromDateTimeLocal(value, tz = FALLBACK_TZ) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes handle zones whose offset changes (DST) near the target time.
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t).toISOString();
}

/** Minutes since midnight, in the given zone. */
export function minutesOfDayInTz(tz = FALLBACK_TZ, now = new Date()) {
  const [h, m] = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':');
  return Number(h) * 60 + Number(m);
}

/** True once the wall clock in `tz` has reached 'HH:MM[:SS]' (same calendar day). */
export function isAtOrAfterTimeInTz(hhmm, tz = FALLBACK_TZ, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return false;
  return minutesOfDayInTz(tz, now) >= Number(m[1]) * 60 + Number(m[2]);
}
