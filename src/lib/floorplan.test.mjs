import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS, MAX_ROWS, addRoom, changeRoom, freeSpot, fromRows, isChanged, nudge, planProblems, problemWith, readingOrder,
  rectsOverlap, removeRoom, setCeoSeat, setDepartment, toPayload,
} from './floorplan.js';

const room = (id, x, y, w, h, extra = {}) => ({ id, name: id, x, y, w, h, department_ids: [], ceo_seat: null, ...extra });

test('overlap: touching rooms do not overlap, sharing a cell does', () => {
  assert.equal(rectsOverlap(room('a', 0, 0, 4, 4), room('b', 4, 0, 4, 4)), false);
  assert.equal(rectsOverlap(room('a', 0, 0, 4, 4), room('b', 0, 4, 4, 4)), false);
  assert.equal(rectsOverlap(room('a', 0, 0, 4, 4), room('b', 3, 3, 4, 4)), true);
});

test('problemWith: bounds, minimum size, overlap and whole numbers', () => {
  const others = [room('a', 0, 0, 4, 4)];
  assert.equal(problemWith(room('b', 4, 0, 4, 4), others), '');
  assert.match(problemWith(room('b', 9, 0, 4, 4), others), /fit/);
  assert.match(problemWith(room('b', -1, 0, 4, 4), others), /fit/);
  assert.match(problemWith(room('b', 0, MAX_ROWS - 1, 4, 2), []), /fit/);
  assert.match(problemWith(room('b', 4, 0, 1, 4), others), /at least/);
  assert.match(problemWith(room('b', 3, 3, 4, 4), others), /overlaps a/);
  assert.match(problemWith(room('b', 1.5, 0, 4, 4), others), /whole/);
});

test('changeRoom: a refused change returns the same list and says why', () => {
  const rooms = [room('a', 0, 0, 4, 4), room('b', 4, 0, 4, 4)];
  const bad = changeRoom(rooms, 'b', { x: 2 });
  assert.equal(bad.rooms, rooms);
  assert.match(bad.error, /overlaps a/);
  const ok = changeRoom(rooms, 'b', { x: 6 });
  assert.equal(ok.error, '');
  assert.equal(ok.rooms.find((r) => r.id === 'b').x, 6);
  assert.equal(rooms.find((r) => r.id === 'b').x, 4, 'the old list is not mutated');
});

test('nudge moves by one cell and resizes with the resize flag', () => {
  const rooms = [room('a', 2, 2, 4, 4)];
  assert.equal(nudge(rooms, 'a', 1, 0).rooms[0].x, 3);
  assert.equal(nudge(rooms, 'a', 1, 1, true).rooms[0].w, 5);
  assert.equal(nudge(rooms, 'a', 0, 1, true).rooms[0].h, 5);
  assert.match(nudge([room('a', 0, 0, 2, 2)], 'a', -1, 0, true).error, /at least/);
  assert.match(nudge([room('a', 0, 0, 4, 4)], 'a', -1, 0).error, /fit/);
});

test('freeSpot and addRoom: first free place, shrinking, names, and a full floor', () => {
  const rooms = [room('a', 0, 0, 12, 4)];
  assert.deepEqual(freeSpot(rooms, 4, 4), { x: 0, y: 4 });
  const added = addRoom(rooms);
  assert.equal(added.name, 'New room');
  assert.deepEqual([added.x, added.y, added.w, added.h], [0, 4, 4, 4]);
  assert.match(added.id, /^new-/);
  const second = addRoom([...rooms, added]);
  assert.equal(second.name, 'New room 2');
  assert.notEqual(second.id, added.id);
  assert.equal(addRoom([room('full', 0, 0, COLS, MAX_ROWS)]), null);
  const tight = [room('a', 0, 0, 12, 38), room('b', 0, 38, 7, 2)];
  const small = addRoom(tight);
  assert.deepEqual([small.w, small.h], [3, 2]);
});

test('a department sits in one room; a CEO seat in one room', () => {
  let rooms = [room('a', 0, 0, 4, 4, { department_ids: ['d1', 'd2'] }), room('b', 4, 0, 4, 4, { ceo_seat: 1 })];
  rooms = setDepartment(rooms, 'b', 'd1', true);
  assert.deepEqual(rooms[0].department_ids, ['d2']);
  assert.deepEqual(rooms[1].department_ids, ['d1']);
  rooms = setDepartment(rooms, 'b', 'd1', false);
  assert.deepEqual(rooms[1].department_ids, []);
  rooms = setCeoSeat(rooms, 'a', 1);
  assert.equal(rooms[0].ceo_seat, 1);
  assert.equal(rooms[1].ceo_seat, null);
  rooms = setCeoSeat(rooms, 'a', null);
  assert.equal(rooms[0].ceo_seat, null);
});

test('planProblems: names and geometry of the whole plan', () => {
  assert.deepEqual(planProblems([room('a', 0, 0, 4, 4), room('b', 4, 0, 4, 4)]), []);
  assert.match(planProblems([room('a', 0, 0, 4, 4, { name: '   ' })])[0], /needs a name/);
  assert.match(planProblems([room('a', 0, 0, 4, 4, { name: 'x'.repeat(41) })])[0], /longer than 40/);
  assert.match(planProblems([room('a', 0, 0, 4, 4), room('b', 2, 2, 4, 4)])[0], /overlaps/);
});

test('isChanged ignores order and surrounding spaces; toPayload keeps real ids only', () => {
  const saved = [room('a', 0, 0, 4, 4), room('b', 4, 0, 4, 4)];
  assert.equal(isChanged(saved, [saved[1], saved[0]]), false);
  assert.equal(isChanged(saved, [{ ...saved[0], name: ' a ' }, saved[1]]), false);
  assert.equal(isChanged(saved, [{ ...saved[0], w: 5 }, saved[1]]), true);
  assert.equal(isChanged(saved, removeRoom(saved, 'a')), true);
  const payload = toPayload([room('new-1', 4, 0, 2, 2, { name: ' Kitchen ' }), room('a', 0, 0, 4, 4)]);
  assert.deepEqual(payload.map((p) => p.name), ['a', 'Kitchen']);
  assert.equal(payload[0].id, 'a');
  assert.equal('id' in payload[1], false);
  assert.equal(payload[1].ceo_seat, null);
});

test('fromRows drops departments that no longer exist; readingOrder is top-to-bottom, left-to-right', () => {
  const rows = [{ id: 'r', name: 'R', x: 0, y: 0, w: 2, h: 2, department_ids: ['d1', 'gone'], ceo_seat: null }];
  assert.deepEqual(fromRows(rows, new Set(['d1']))[0].department_ids, ['d1']);
  assert.deepEqual(fromRows(rows)[0].department_ids, ['d1', 'gone']);
  assert.deepEqual(readingOrder([room('c', 8, 0, 2, 2), room('b', 0, 4, 2, 2), room('a', 0, 0, 2, 2)]).map((r) => r.id), ['a', 'c', 'b']);
});
