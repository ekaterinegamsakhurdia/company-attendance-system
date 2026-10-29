import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOffice, fallbackLayout } from './office.js';

const row = (o) => ({ seat: 1, role: 'employee', department_id: null, department_name: null, present: false, employee_id: null, first_name: null, last_name: null, avatar_path: null, work_mode: null, overtime: false, ...o });
const here = (id, first, o) => row({ present: true, employee_id: id, first_name: first, last_name: 'X', work_mode: 'office', ...o });
const room = (id, name, x, y, w, h, extra = {}) => ({ id, name, x, y, w, h, department_ids: [], ceo_seat: null, ...extra });

const layout = [
  room('r1', 'Studio', 0, 0, 4, 4, { department_ids: ['d1', 'd2'] }),
  room('r2', 'Boss', 4, 0, 4, 2, { ceo_seat: 2 }),
  room('r3', 'Kitchen', 8, 0, 2, 2),
];

test('people land in the room that holds their department or CEO seat', () => {
  const rows = [
    here('e1', 'Ann', { department_id: 'd1' }),
    row({ department_id: 'd1' }),
    row({ department_id: 'd2' }),
    here('e2', 'Bob', { department_id: 'd2', work_mode: 'online' }),
    row({ role: 'ceo', seat: 1 }),
    here('c2', 'Cee', { role: 'ceo', seat: 2 }),
  ];
  const { rooms, summary } = buildOffice(rows, layout);
  const studio = rooms.find((r) => r.title === 'Studio');
  assert.equal(studio.seats, 4);
  assert.deepEqual(studio.people.map((p) => p.first_name), ['Ann', 'Bob']);
  assert.equal(studio.people[1].mode, 'online');
  const boss = rooms.find((r) => r.title === 'Boss');
  assert.equal(boss.seats, 1);
  assert.equal(boss.people[0].first_name, 'Cee');
  assert.deepEqual(summary, { office: 2, online: 1, present: 3, seats: 5, away: 2 });
});

test('developers, teams without a room, and CEOs without a seat room are not drawn', () => {
  const rows = [
    here('dev', 'Dev', { role: 'developer' }),
    here('x', 'Xena', { department_id: 'other' }),
    here('y', 'Yan', { role: 'ceo', seat: 1 }),
    row({ department_id: null }),
  ];
  const { rooms, summary } = buildOffice(rows, layout);
  assert.equal(rooms.reduce((n, r) => n + r.seats, 0), 0);
  assert.deepEqual(summary, { office: 0, online: 0, present: 0, seats: 0, away: 0 });
});

test('rooms come back in reading order with their place, size and whether anyone sits there', () => {
  const { rooms } = buildOffice([], [layout[2], layout[1], layout[0]]);
  assert.deepEqual(rooms.map((r) => r.title), ['Studio', 'Boss', 'Kitchen']);
  assert.deepEqual([rooms[0].x, rooms[0].y, rooms[0].w, rooms[0].h], [0, 0, 4, 4]);
  assert.deepEqual(rooms.map((r) => r.sits), [true, true, false]);
});

test('an empty plan draws nothing', () => {
  const { rooms, summary } = buildOffice([here('e1', 'Ann', { department_id: 'd1' })], []);
  assert.deepEqual(rooms, []);
  assert.equal(summary.present, 0);
});

test('the built-in plan matches departments by name like the database does', () => {
  const rows = [
    row({ department_id: 'a', department_name: 'Graphic Design' }),
    row({ department_id: 'b', department_name: 'Production' }),
    row({ department_id: 'c', department_name: 'Account Management' }),
    row({ department_id: 'd', department_name: 'Copywriting' }),
    row({ department_id: 'e', department_name: 'Advertising' }),
  ];
  const plan = fallbackLayout(rows);
  assert.equal(plan.length, 6);
  const dep = (name) => plan.find((r) => r.name === name).department_ids;
  assert.deepEqual(dep('Designers'), ['a']);
  assert.deepEqual(dep('Production'), ['b']);
  assert.deepEqual(dep('Account managers'), ['c']);
  assert.deepEqual(dep('Copywriters'), ['d']);
  assert.equal(plan.find((r) => r.name === 'CEO 1').ceo_seat, 1);
  assert.equal(plan.find((r) => r.name === 'CEO 2').ceo_seat, 2);
  assert.ok(!plan.some((r) => r.department_ids.includes('e')), 'Advertising has no room');
});

test('the floor is trimmed to the rooms: no empty strip on the right or at the top', async () => {
  const { fitFloor } = await import('./office.js');
  const fit = fitFloor([room('a', 'A', 2, 3, 4, 4), room('b', 'B', 6, 3, 4, 2)]);
  assert.equal(fit.cols, 8);
  assert.equal(fit.rows, 4);
  assert.deepEqual(fit.rooms.map((r) => [r.x, r.y]), [[0, 0], [4, 0]]);
  assert.deepEqual(fitFloor([]), { rooms: [], cols: 1, rows: 1 });
  assert.equal(fitFloor([room('a', 'A', 0, 0, 12, 2)]).cols, 12);
});
