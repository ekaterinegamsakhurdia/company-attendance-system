// The office floor plan as plain data, and every rule for editing it.
//
// A room is { id, name, x, y, w, h, department_ids, ceo_seat } on a grid of COLS columns and MAX_ROWS rows
// (x, y = top-left cell). Rooms may not overlap and may not leave the grid. The database enforces the same
// rules (migration 15); these functions let the editor refuse a bad move before it is even tried.

export const COLS = 12;
export const MAX_ROWS = 40;
export const MIN_W = 2;
export const MIN_H = 2;
export const MAX_ROOMS = 40;
export const MAX_NAME = 40;
export const CEO_SEATS = 4;

const isNew = (room) => String(room.id).startsWith('new-');

export const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Reading order: top to bottom, then left to right (also the order rooms stack in on a phone). */
export const readingOrder = (rooms) => [...rooms].sort((a, b) => a.y - b.y || a.x - b.x || a.name.localeCompare(b.name));

/** Why a room cannot be where it is, or '' when it can. `others` must not contain the room itself. */
export function problemWith(room, others) {
  if (!Number.isInteger(room.x) || !Number.isInteger(room.y) || !Number.isInteger(room.w) || !Number.isInteger(room.h)) return 'Use whole numbers.';
  if (room.w < MIN_W || room.h < MIN_H) return `A room is at least ${MIN_W} wide and ${MIN_H} high.`;
  if (room.x < 0 || room.y < 0 || room.x + room.w > COLS || room.y + room.h > MAX_ROWS) return 'That does not fit on the floor.';
  const hit = others.find((o) => rectsOverlap(room, o));
  return hit ? `That overlaps ${hit.name || 'another room'}.` : '';
}

/**
 * Change one room. Returns { rooms, error }: the new list, or the old list and the reason it was refused.
 * Moving and resizing both go through here, so the mouse, the arrow keys and the number boxes follow the same rules.
 */
export function changeRoom(rooms, id, patch) {
  const room = rooms.find((r) => r.id === id);
  if (!room) return { rooms, error: '' };
  const next = { ...room, ...patch };
  const error = problemWith(next, rooms.filter((r) => r.id !== id));
  if (error) return { rooms, error };
  return { rooms: rooms.map((r) => (r.id === id ? next : r)), error: '' };
}

/** The first free place (reading order) for a w x h room, or null when the floor is full. */
export function freeSpot(rooms, w, h) {
  for (let y = 0; y + h <= MAX_ROWS; y += 1) {
    for (let x = 0; x + w <= COLS; x += 1) {
      if (!rooms.some((r) => rectsOverlap({ x, y, w, h }, r))) return { x, y };
    }
  }
  return null;
}

let counter = 0;

/** A new, empty room in the first free place; the size shrinks until one fits. Returns null when the floor is full. */
export function addRoom(rooms) {
  if (rooms.length >= MAX_ROOMS) return null;
  for (const [w, h] of [[4, 4], [4, 3], [3, 3], [3, 2], [2, 2]]) {
    const spot = freeSpot(rooms, w, h);
    if (spot) {
      counter += 1;
      const taken = new Set(rooms.map((r) => r.name));
      let name = 'New room';
      for (let i = 2; taken.has(name); i += 1) name = `New room ${i}`;
      return { id: `new-${counter}`, name, ...spot, w, h, department_ids: [], ceo_seat: null };
    }
  }
  return null;
}

/** A department sits in one room only: ticking it here takes it out of any other room. */
export function setDepartment(rooms, roomId, departmentId, on) {
  return rooms.map((r) => {
    const without = r.department_ids.filter((d) => d !== departmentId);
    if (r.id === roomId) return { ...r, department_ids: on ? [...without, departmentId] : without };
    return without.length === r.department_ids.length ? r : { ...r, department_ids: without };
  });
}

/** A CEO seat is in one room only (null = nobody). */
export function setCeoSeat(rooms, roomId, seat) {
  return rooms.map((r) => {
    if (r.id === roomId) return { ...r, ceo_seat: seat };
    return seat != null && r.ceo_seat === seat ? { ...r, ceo_seat: null } : r;
  });
}

export const removeRoom = (rooms, id) => rooms.filter((r) => r.id !== id);

/** What is wrong with the whole plan (shown before saving). */
export function planProblems(rooms) {
  const out = [];
  rooms.forEach((r, i) => {
    if (!r.name.trim()) out.push(`Room ${i + 1} needs a name.`);
    else if (r.name.trim().length > MAX_NAME) out.push(`"${r.name.slice(0, 20)}…" is longer than ${MAX_NAME} characters.`);
    const bad = problemWith(r, rooms.filter((o) => o !== r));
    if (bad) out.push(`${r.name.trim() || `Room ${i + 1}`}: ${bad}`);
  });
  return out;
}

const norm = (rooms) =>
  readingOrder(rooms).map((r) => [r.id, r.name.trim(), r.x, r.y, r.w, r.h, [...r.department_ids].sort().join(','), r.ceo_seat ?? null]);

/** True when the draft differs from the saved plan. */
export const isChanged = (saved, draft) => JSON.stringify(norm(saved)) !== JSON.stringify(norm(draft));

/** The shape dev_save_office_layout() takes. Rooms that exist keep their id; new ones get one from the database. */
export const toPayload = (rooms) =>
  readingOrder(rooms).map((r) => ({
    ...(isNew(r) ? {} : { id: r.id }),
    name: r.name.trim(),
    x: r.x, y: r.y, w: r.w, h: r.h,
    department_ids: r.department_ids,
    ceo_seat: r.ceo_seat ?? null,
  }));

/** Rows from the database -> editor rooms (department ids that no longer exist are dropped). */
export const fromRows = (rows = [], knownDepartmentIds = null) =>
  rows.map((r) => ({
    id: r.id,
    name: r.name,
    x: r.x, y: r.y, w: r.w, h: r.h,
    department_ids: (r.department_ids ?? []).filter((d) => !knownDepartmentIds || knownDepartmentIds.has(d)),
    ceo_seat: r.ceo_seat ?? null,
  }));

/** Move or resize by a number of cells, as far as the rules allow in a straight line (used by mouse and keys). */
export function nudge(rooms, id, dx, dy, resize = false) {
  const room = rooms.find((r) => r.id === id);
  if (!room) return { rooms, error: '' };
  return changeRoom(rooms, id, resize ? { w: room.w + dx, h: room.h + dy } : { x: room.x + dx, y: room.y + dy });
}
