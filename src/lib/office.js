import { readingOrder } from './floorplan.js';

// The "Office today" map: turns the rows of public.office_today() and the saved floor plan into rooms.
//
// One row per active employee. A row is `present` only for people who are clocked in right now;
// everybody else is an anonymous empty seat (no name, no id), by design.

/** Department name -> room of the original plan (used for the built-in plan only). */
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

/**
 * The plan used when the saved one cannot be read (the database update that stores floor plans has not been run yet):
 * the six rooms of the real office, with departments matched by name, exactly like the database's own first plan.
 */
export function fallbackLayout(rows = []) {
  const names = new Map();
  for (const r of rows) if (r.department_id) names.set(r.department_id, r.department_name);
  const depts = (area) => [...names].filter(([, n]) => areaOfDepartment(n) === area).map(([id]) => id);
  return [
    { id: 'default-design', name: 'Designers', x: 0, y: 0, w: 4, h: 4, department_ids: depts('design'), ceo_seat: null },
    { id: 'default-accounts', name: 'Account managers', x: 4, y: 0, w: 4, h: 8, department_ids: depts('accounts'), ceo_seat: null },
    { id: 'default-copy', name: 'Copywriters', x: 8, y: 0, w: 4, h: 4, department_ids: depts('copy'), ceo_seat: null },
    { id: 'default-production', name: 'Production', x: 0, y: 4, w: 4, h: 4, department_ids: depts('production'), ceo_seat: null },
    { id: 'default-ceo2', name: 'CEO 2', x: 8, y: 4, w: 4, h: 2, department_ids: [], ceo_seat: 2 },
    { id: 'default-ceo1', name: 'CEO 1', x: 8, y: 6, w: 4, h: 2, department_ids: [], ceo_seat: 1 },
  ];
}

/**
 * rooms: the saved plan, in reading order, each with the people in it:
 *   [{ key, title, x, y, w, h, sits, seats, people[] }]
 *   sits = the room holds a team or a CEO seat (a plain room such as a kitchen does not)
 * summary: { office, online, present, seats, away } - counted over the people who have a room.
 * Developers are never on the map; teams without a room are not drawn.
 */
export function buildOffice(rows = [], layout = []) {
  const ordered = readingOrder(layout);
  const rooms = ordered.map((r) => ({
    key: r.id, title: r.name, x: r.x, y: r.y, w: r.w, h: r.h,
    sits: r.department_ids.length > 0 || r.ceo_seat != null,
    seats: 0, people: [],
  }));
  const byDepartment = new Map();
  const bySeat = new Map();
  rooms.forEach((room, i) => {
    const src = ordered[i];
    for (const d of src.department_ids) byDepartment.set(d, room);
    if (src.ceo_seat != null) bySeat.set(src.ceo_seat, room);
  });

  for (const r of rows) {
    const target = r.role === 'ceo' ? bySeat.get(r.seat) : r.role === 'developer' ? null : byDepartment.get(r.department_id);
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

/**
 * Trim the plan to the space the rooms really use, so the floor's outline hugs the rooms (no empty strip of
 * floor on the right or at the top): { rooms (x and y counted from the top-left room), cols, rows }.
 */
export function fitFloor(rooms = []) {
  if (rooms.length === 0) return { rooms: [], cols: 1, rows: 1 };
  const minX = Math.min(...rooms.map((r) => r.x));
  const minY = Math.min(...rooms.map((r) => r.y));
  const cols = Math.max(...rooms.map((r) => r.x + r.w)) - minX;
  const rows = Math.max(...rooms.map((r) => r.y + r.h)) - minY;
  return { rooms: rooms.map((r) => ({ ...r, x: r.x - minX, y: r.y - minY })), cols, rows };
}

export const statusText = (p) =>
  p.mode === 'online' ? 'Online, working from home' : 'In the office';
