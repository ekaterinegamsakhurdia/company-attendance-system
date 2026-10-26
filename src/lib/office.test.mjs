import test from 'node:test';
import assert from 'node:assert/strict';
import { areaOfDepartment, buildOffice, driftOf, hashOf, statusText } from './office.js';

const row = (o) => ({ seat: 1, role: 'employee', department_id: 'd1', department_name: 'Design', present: false, employee_id: null, first_name: null, last_name: null, avatar_path: null, work_mode: null, overtime: false, ...o });
const here = (id, first, o = {}) => row({ present: true, employee_id: id, first_name: first, last_name: 'X', work_mode: 'office', ...o });

test('departments map to the rooms of the plan', () => {
  assert.equal(areaOfDepartment('Design'), 'design');
  assert.equal(areaOfDepartment('Designers'), 'design');
  assert.equal(areaOfDepartment('Production'), 'production');
  assert.equal(areaOfDepartment('Account Managers'), 'accounts');
  assert.equal(areaOfDepartment('Copywriting'), 'copy');
  assert.equal(areaOfDepartment('Advertising'), 'extra');
  assert.equal(areaOfDepartment(null), 'extra');
});

test('always the six rooms of the sketch, in order', () => {
  const { rooms } = buildOffice([]);
  assert.deepEqual(rooms.map((r) => r.title), ['Designers', 'Production', 'Account managers', 'Copywriters', 'CEO 2', 'CEO 1']);
  assert.deepEqual(rooms.map((r) => r.area), ['design', 'production', 'accounts', 'copy', 'ceo2', 'ceo1']);
});

test('rooms, people, seats and the summary', () => {
  const { rooms, summary } = buildOffice([
    here('a', 'Bea'), here('b', 'Al', { work_mode: 'online' }), row({}),
    row({ department_id: 'd2', department_name: 'Production' }),
    row({ role: 'ceo', department_id: null, department_name: null, seat: 1 }),
    here('c', 'Cee', { role: 'ceo', department_id: null, department_name: null, seat: 2 }),
  ]);
  const by = Object.fromEntries(rooms.map((r) => [r.area, r]));
  assert.deepEqual(by.design.people.map((p) => p.first_name), ['Al', 'Bea']);       // sorted by name
  assert.equal(by.design.seats, 3);
  assert.equal(by.production.people.length, 0);
  assert.equal(by.production.seats, 1);
  assert.equal(by.ceo1.seats, 1);
  assert.equal(by.ceo1.people.length, 0);
  assert.equal(by.ceo2.people[0].first_name, 'Cee');
  assert.deepEqual(summary, { office: 2, online: 1, present: 3, seats: 6, away: 3 });
});

test('developers, extra CEOs and teams without a room are not on the map', () => {
  const { rooms, summary } = buildOffice([
    here('d', 'Dev', { role: 'developer', department_id: null, department_name: null }),
    here('x', 'Xa', { department_id: 'd9', department_name: 'Advertising' }),
    here('c', 'Third', { role: 'ceo', department_id: null, department_name: null, seat: 3 }),
    here('n', 'Nobody', { department_id: null, department_name: null }),
  ]);
  assert.equal(rooms.length, 6);
  assert.equal(rooms.reduce((n, r) => n + r.people.length + r.seats, 0), 0);
  assert.equal(summary.present, 0);
});

test('online and overtime flags travel with the person; empty input is fine', () => {
  const { rooms } = buildOffice([here('a', 'Al', { work_mode: 'online', overtime: true })]);
  assert.deepEqual(rooms[0].people[0], { id: 'a', first_name: 'Al', last_name: 'X', avatar_path: null, mode: 'online', overtime: true });
  assert.deepEqual(buildOffice().summary, { office: 0, online: 0, present: 0, seats: 0, away: 0 });
  assert.equal(statusText({ mode: 'online' }), 'Online, working from home');
  assert.equal(statusText({ mode: 'office' }), 'In the office');
});

test('drift is stable per person and stays in range', () => {
  assert.deepEqual(driftOf('abc'), driftOf('abc'));
  assert.notDeepEqual(driftOf('abc'), driftOf('abd'));
  assert.equal(hashOf('abc'), hashOf('abc'));
  for (const id of ['a', 'b', 'c', 'dd', 'eee', 'e-1', 'e-2']) {
    const d = driftOf(id);
    assert.ok(Math.abs(d.dx) <= 7 && Math.abs(d.dy) <= 9 && d.duration >= 5 && d.duration <= 9 && d.delay <= 0 && d.delay > -6.1, JSON.stringify(d));
  }
});
