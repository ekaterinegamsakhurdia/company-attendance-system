// The "Office today" map: turns the rows of public.office_today() into rooms.
//
// One row per active employee. A row is `present` only for people who are clocked in right now;
// everybody else is an anonymous empty seat (no name, no id), by design.

/** Department name -> room. A team without a room (e.g. Advertising) is simply not on the map. */
const AREAS = [
  [/design/i, 'design'],
  [/production/i, 'production'],
  [/account/i, 'accounts'],
  [/copy/i, 'copy'],
];

export const areaOfDepartment = (name) => AREAS.find(([re]) => re.test(name ?? ''))?.[1] ?? 'extra';

/** A stable number from text (0 .. 2^32), so every bubble drifts in its own way but always the same. */
export function hashOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Drift parameters for one bubble: offsets in px, duration and delay in seconds. */
export function driftOf(id) {
  const h = hashOf(id);
  const pick = (shift, span) => ((h >>> shift) % (span * 2 + 1)) - span;
  return {
    dx: pick(0, 7),
    dy: pick(5, 9),
    duration: 5 + ((h >>> 11) % 40) / 10,
    delay: -(((h >>> 17) % 60) / 10),
  };
}

const personOf = (r) => ({
  id: r.employee_id,
  first_name: r.first_name,
  last_name: r.last_name,
  avatar_path: r.avatar_path,
  mode: r.work_mode === 'online' ? 'online' : 'office',
  overtime: Boolean(r.overtime),
});

/** The six rooms of the real office, in reading order (also the order they stack in on a phone). */
export const ROOMS = [
  { area: 'design', title: 'Designers' },
  { area: 'production', title: 'Production' },
  { area: 'accounts', title: 'Account managers' },
  { area: 'copy', title: 'Copywriters' },
  { area: 'ceo2', title: 'CEO 2' },
  { area: 'ceo1', title: 'CEO 1' },
];

/** Which room a row belongs to, or null (developers and teams without a room are not on the map). */
export function areaOfRow(r) {
  if (r.role === 'ceo') return r.seat === 1 ? 'ceo1' : r.seat === 2 ? 'ceo2' : null;
  if (r.role === 'developer') return null;
  const area = areaOfDepartment(r.department_name);
  return area === 'extra' ? null : area;
}

/**
 * rooms: always the six rooms of the plan: [{ key, area, title, seats, people[] }]
 * summary: { office, online, present, seats, away } - counted over the people who have a room.
 */
export function buildOffice(rows = []) {
  const rooms = ROOMS.map((r) => ({ key: r.area, area: r.area, title: r.title, seats: 0, people: [] }));
  const byArea = new Map(rooms.map((r) => [r.area, r]));
  for (const r of rows) {
    const target = byArea.get(areaOfRow(r));
    if (!target) continue;
    target.seats += 1;
    if (r.present) target.people.push(personOf(r));
  }
  for (const r of rooms) r.people.sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));

  const present = rooms.reduce((n, r) => n + r.people.length, 0);
  const online = rooms.reduce((n, r) => n + r.people.filter((p) => p.mode === 'online').length, 0);
  const seats = rooms.reduce((n, r) => n + r.seats, 0);
  return { rooms, summary: { office: present - online, online, present, seats, away: seats - present } };
}

export const statusText = (p) =>
  p.mode === 'online' ? 'Online, working from home' : 'In the office';
