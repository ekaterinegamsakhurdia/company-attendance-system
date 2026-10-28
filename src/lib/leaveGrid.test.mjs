import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDays, buildLeaveGrid, groupByDepartment } from './leaveGrid.js';

const days = buildDays('2026-10-26', '2026-11-03', [{ holiday_date: '2026-10-30', name: 'Test holiday' }], '2026-10-28');
const ann = { id: 'a', first_name: 'Ann', last_name: 'A', department_id: 'd1' };
const bob = { id: 'b', first_name: 'Bob', last_name: 'B', department_id: 'd2' };
const leave = (o) => ({ id: 'l', employee_id: 'a', category: 'vacation', status: 'approved', start_date: '2026-10-27', end_date: '2026-10-27', ...o });
const kinds = (row) => row.cells.map((c) => c.kind);

test('colours: vacation, unpaid, day off, holiday', () => {
  const [row] = buildLeaveGrid({
    people: [ann],
    days,
    leaves: [
      leave({ category: 'vacation', start_date: '2026-10-26', end_date: '2026-10-26' }),
      leave({ category: 'day_off', start_date: '2026-10-27', end_date: '2026-10-27' }),
      leave({ category: 'unpaid', start_date: '2026-10-28', end_date: '2026-10-28' }),
    ],
  });
  assert.deepEqual(kinds(row).slice(0, 5), ['vacation', 'day_off', 'unpaid', 'none', 'holiday']);
  assert.equal(row.cells[4].title, 'Test holiday');
});

test('a holiday is blue for everybody, a weekend stays a weekend, even inside a leave', () => {
  const rows = buildLeaveGrid({ people: [ann, bob], days, leaves: [leave({ start_date: '2026-10-29', end_date: '2026-11-02' })] });
  // 29 Thu leave, 30 Fri holiday, 31 Sat + 1 Sun weekend, 2 Mon leave
  assert.deepEqual(kinds(rows[0]).slice(3, 8), ['vacation', 'holiday', 'weekend', 'weekend', 'vacation']);
  assert.equal(rows[1].cells[4].kind, 'holiday');
  assert.deepEqual(rows[0].totals, { vacation: 2, unpaid: 0, day_off: 0 });
});

test('pending shows but is not counted; approved beats pending; cancelled and rejected are ignored', () => {
  const [row] = buildLeaveGrid({
    people: [ann],
    days,
    leaves: [
      leave({ id: 'p', status: 'pending', category: 'unpaid' }),
      leave({ id: 'x', status: 'rejected', category: 'day_off', start_date: '2026-10-26', end_date: '2026-10-26' }),
      leave({ id: 'c', status: 'cancelled', category: 'day_off', start_date: '2026-10-28', end_date: '2026-10-28' }),
    ],
  });
  assert.equal(row.cells[1].kind, 'unpaid');
  assert.equal(row.cells[1].pending, true);
  assert.equal(row.cells[0].kind, 'none');
  assert.equal(row.cells[2].kind, 'none');
  assert.deepEqual(row.totals, { vacation: 0, unpaid: 0, day_off: 0 });

  const [both] = buildLeaveGrid({ people: [ann], days, leaves: [leave({ id: 'p', status: 'pending', category: 'unpaid' }), leave({ id: 'ok', category: 'vacation' })] });
  assert.equal(both.cells[1].kind, 'vacation');
  assert.equal(both.cells[1].pending, false);
});

test("other people's leaves never land on a row", () => {
  const [row] = buildLeaveGrid({ people: [ann], days, leaves: [leave({ employee_id: 'b' })] });
  assert.ok(kinds(row).every((k) => k !== 'vacation'));
});

test('groups by department in department order, leadership last, names sorted', () => {
  const ceo = { id: 'c', first_name: 'Cee', last_name: 'O', department_id: null };
  const zed = { id: 'z', first_name: 'Zed', last_name: 'Z', department_id: 'd1' };
  const rows = buildLeaveGrid({ people: [ceo, bob, zed, ann], days, leaves: [] });
  const groups = groupByDepartment(rows, [{ id: 'd1', name: 'Design' }, { id: 'd2', name: 'Production' }]);
  assert.deepEqual(groups.map((g) => g.name), ['Design', 'Production', 'Leadership']);
  assert.deepEqual(groups[0].rows.map((r) => r.person.first_name), ['Ann', 'Zed']);
});
