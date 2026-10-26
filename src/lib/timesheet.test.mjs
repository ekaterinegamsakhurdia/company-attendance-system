import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDays, buildTimesheet, cellTitle, companyHours, formatHours, sortRows } from './timesheet.js';
import { effectiveApproverId, approverOptions, filterPeople, hasFilters } from './reportFilters.js';
import { shiftRange } from './calendar.js';

const emp = (id, first, extra = {}) => ({ id, first_name: first, last_name: 'T', is_active: true, role: 'employee', department_id: null, ...extra });
const holidays = [{ holiday_date: '2026-10-14', name: 'Svetitskhovloba' }];
const days = buildDays('2026-10-09', '2026-10-16', holidays, '2026-10-13');

test('formatHours and companyHours', () => {
  assert.equal(formatHours(8), '8');
  assert.equal(formatHours(7.46), '7.5');
  assert.equal(formatHours(7.04), '7');
  assert.equal(formatHours(0), '0');
  assert.equal(formatHours(null), '');
  assert.equal(companyHours('11:00:00', '19:00:00'), 8);
  assert.equal(companyHours('09:30', '17:00'), 7.5);
  assert.equal(companyHours(null, null), 8);
  assert.equal(companyHours('19:00', '11:00'), 8);
});

test('columns: weekdays, weekend, holiday and today', () => {
  assert.deepEqual(days.map((d) => d.weekday), ['Fr', 'Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr']);
  assert.equal(days.find((d) => d.date === '2026-10-14').holiday, 'Svetitskhovloba');
  assert.equal(days.find((d) => d.date === '2026-10-13').today, true);
  assert.equal(days[1].weekend, true);
});

test('cells: worked, leave, pending, holiday, weekend, absent, planned', () => {
  const people = [emp('a', 'Ann'), emp('b', 'Bob')];
  const attendance = [
    { employee_id: 'a', work_date: '2026-10-09', clock_in: '2026-10-09T07:00:00Z', clock_out: '2026-10-09T14:30:00Z', worked_minutes: 450 },
    { employee_id: 'a', work_date: '2026-10-13', clock_in: '2026-10-13T07:00:00Z', clock_out: null, worked_minutes: null },
  ];
  const leaves = [
    { employee_id: 'a', category: 'vacation', status: 'approved', start_date: '2026-10-12', end_date: '2026-10-12' },
    { employee_id: 'b', category: 'unpaid', status: 'approved', start_date: '2026-10-09', end_date: '2026-10-12' },   // spans the weekend
    { employee_id: 'b', category: 'day_off', status: 'pending', start_date: '2026-10-15', end_date: '2026-10-15' },
    { employee_id: 'b', category: 'day_off', status: 'rejected', start_date: '2026-10-16', end_date: '2026-10-16' },
  ];
  const rows = buildTimesheet({ people, days, attendance, leaves, today: '2026-10-13', nowMs: Date.parse('2026-10-13T09:00:00Z') });
  const kinds = (i) => rows[i].cells.map((c) => c.kind);
  assert.deepEqual(kinds(0), ['worked', 'weekend', 'weekend', 'leave', 'worked', 'holiday', 'planned', 'planned']);
  assert.equal(rows[0].cells[0].hours, 7.5);
  assert.equal(rows[0].cells[4].open, true);
  assert.equal(Math.round(rows[0].cells[4].hours), 2);   // 07:00Z -> 09:00Z
  assert.deepEqual(rows[0].totals.v, 1);
  assert.deepEqual(kinds(1), ['leave', 'weekend', 'weekend', 'leave', 'planned', 'holiday', 'pending', 'planned']);
  assert.equal(rows[1].totals.ul, 2);                    // Fri 9 + Mon 12, the weekend is not counted
  assert.equal(rows[1].totals.do, 0);                    // pending and rejected do not count
  assert.equal(rows[1].cells[6].leave.category, 'day_off');
  assert.equal(rows[1].cells[7].hours, 8);               // rejected leave leaves a normal planned day
  assert.equal(Math.round(rows[0].totals.hours * 10) / 10, 9.5);
});

test('per-person hours, start date and attendance on a holiday', () => {
  const people = [emp('a', 'Ann')];
  const profiles = new Map([['a', { employee_id: 'a', daily_hours: '6.5', hire_date: '2026-10-12' }]]);
  const attendance = [{ employee_id: 'a', work_date: '2026-10-14', clock_in: 'x', clock_out: 'y', worked_minutes: 120 }];
  const [row] = buildTimesheet({ people, days, attendance, leaves: [], profiles, defaultHours: 8, today: '2026-10-13' });
  assert.equal(row.cells[0].kind, 'na');                 // before the start date
  assert.equal(row.cells[3].kind, 'absent');             // 12 Oct: started, no record
  assert.equal(row.cells[5].kind, 'worked');             // worked on the holiday: shown
  assert.equal(row.cells[6].hours, 6.5);                 // planned = personal hours
});

test('cellTitle and sortRows', () => {
  const [row] = buildTimesheet({ people: [emp('a', 'Ann')], days, attendance: [], leaves: [{ employee_id: 'a', category: 'vacation', status: 'pending', start_date: '2026-10-15', end_date: '2026-10-15' }], today: '2026-10-13' });
  assert.match(cellTitle(row.cells[6], days[6], { vacation: 'Vacation' }), /Vacation \(pending\)/);
  assert.match(cellTitle(row.cells[5], days[5]), /Svetitskhovloba/);
  const sorted = sortRows([{ person: emp('b', 'Zed') }, { person: emp('a', 'Amy') }]);
  assert.deepEqual(sorted.map((r) => r.person.first_name), ['Amy', 'Zed']);
  assert.deepEqual(sortRows(sorted, -1).map((r) => r.person.first_name), ['Zed', 'Amy']);
});

test('shiftRange moves whole months or the same length', () => {
  assert.deepEqual(shiftRange('2026-10-01', '2026-10-31', 1), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(shiftRange('2026-01-01', '2026-01-31', -1), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(shiftRange('2026-02-01', '2026-02-28', 1), { from: '2026-03-01', to: '2026-03-31' });
  assert.deepEqual(shiftRange('2026-10-05', '2026-10-11', 1), { from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual(shiftRange('2026-10-05', '2026-10-11', -1), { from: '2026-09-28', to: '2026-10-04' });
});

test('approver and people filters', () => {
  const departments = [{ id: 'd1', name: 'Design', head_employee_id: 'h' }, { id: 'd2', name: 'Prod', head_employee_id: null }];
  const employees = [
    emp('h', 'Head', { department_id: 'd1' }), emp('a', 'Ann', { department_id: 'd1' }), emp('b', 'Bob', { department_id: 'd2' }),
    emp('c', 'Chief', { role: 'ceo' }), emp('x', 'Gone', { department_id: 'd1', is_active: false }),
  ];
  const profiles = new Map([['b', { approver_id: 'c' }]]);
  assert.equal(effectiveApproverId(employees[1], undefined, departments), 'h');
  assert.equal(effectiveApproverId(employees[0], undefined, departments), null);       // a head never approves themselves
  assert.equal(effectiveApproverId(employees[2], profiles.get('b'), departments), 'c'); // explicit approver wins
  assert.equal(effectiveApproverId(employees[2], undefined, departments), null);
  assert.deepEqual(approverOptions(employees, departments).map((o) => o.value), ['c', 'h']);   // sorted by name: Chief, Head

  const f = (extra) => filterPeople({ employees, profiles, departments, ...extra }).map((e) => e.id);
  assert.deepEqual(f({}), ['h', 'a', 'b', 'c', 'x']);
  assert.deepEqual(f({ teamIds: ['d1'] }), ['h', 'a', 'x']);
  assert.deepEqual(f({ teamIds: ['__none__'] }), ['c']);
  assert.deepEqual(f({ employeeIds: ['a', 'b'] }), ['a', 'b']);
  assert.deepEqual(f({ approverIds: ['h'] }), ['a', 'x']);
  assert.deepEqual(f({ approverIds: ['c'] }), ['h', 'b', 'c']);   // Bob names Chief; Head and Chief have no named approver, so any CEO
  assert.deepEqual(f({ approverIds: ['h'], teamIds: ['d2'] }), []);
  assert.equal(hasFilters({ employeeIds: [], teamIds: [], approverIds: [] }), false);
  assert.equal(hasFilters({ employeeIds: [], teamIds: ['d1'], approverIds: [] }), true);
});

test('online days and overtime are marked and totalled', () => {
  const people = [emp('a', 'Ann')];
  const attendance = [
    { employee_id: 'a', work_date: '2026-10-09', clock_in: 'x', clock_out: 'y', worked_minutes: 480, work_mode: 'online', overtime_minutes: 0 },
    { employee_id: 'a', work_date: '2026-10-12', clock_in: 'x', clock_out: 'y', worked_minutes: 570, work_mode: 'office', overtime_minutes: 90 },
    { employee_id: 'a', work_date: '2026-10-13', clock_in: 'x', clock_out: 'y', worked_minutes: 420 },   // old rows without the new columns
  ];
  const [row] = buildTimesheet({ people, days, attendance, leaves: [], today: '2026-10-13' });
  assert.equal(row.cells[0].online, true);
  assert.equal(row.cells[3].online, false);
  assert.equal(row.cells[3].overtimeMinutes, 90);
  assert.equal(row.cells[4].overtimeMinutes, 0);
  assert.equal(row.totals.online, 1);
  assert.equal(row.totals.overtime, 1.5);
  assert.match(cellTitle(row.cells[0], days[0]), /Online work day/);
  assert.match(cellTitle(row.cells[3], days[3]), /Overtime 1\.5 h/);
});
