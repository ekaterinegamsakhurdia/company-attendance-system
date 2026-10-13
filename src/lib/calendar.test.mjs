import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, dateRange, eachDay, eventsByDay, isWeekend, monthGrid, shiftMonth, weekdayIndex } from './calendar.js';

test('date arithmetic crosses month, year and leap boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-01-01', '2026-12-31'), 364);
  assert.equal(daysBetween('2026-05-02', '2026-05-01'), -1);
});

test('weekdays are Monday-first', () => {
  assert.equal(weekdayIndex('2026-10-12'), 0); // Monday
  assert.equal(weekdayIndex('2026-10-18'), 6); // Sunday
  assert.equal(isWeekend('2026-10-17'), true);
  assert.equal(isWeekend('2026-10-16'), false);
});

test('shiftMonth wraps years in both directions', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 3, -15), { year: 2024, month: 12 });
});

test('monthGrid starts on Monday and holds the whole month', () => {
  const weeks = monthGrid(2026, 10); // 1 Oct 2026 is a Thursday
  assert.equal(weeks[0][0].date, '2026-09-28');
  assert.equal(weeks[0][3].date, '2026-10-01');
  assert.equal(weeks[0][3].inMonth, true);
  assert.equal(weeks[0][0].inMonth, false);
  const inMonth = weeks.flat().filter((c) => c.inMonth);
  assert.equal(inMonth.length, 31);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.ok(weeks.length >= 4 && weeks.length <= 6);
  // February 2027 starts on a Monday and has exactly four weeks
  const feb = monthGrid(2027, 2);
  assert.equal(feb.length, 4);
  assert.equal(feb[0][0].date, '2027-02-01');
});

test('eventsByDay spreads multi-day events and clips to the window', () => {
  const events = [{ id: 'a', start: '2026-10-05', end: '2026-10-07' }, { id: 'b', start: '2026-09-29', end: '2026-10-02' }, { id: 'c', start: '2026-10-09' }];
  const map = eventsByDay(events, '2026-10-01', '2026-10-31');
  assert.deepEqual(map.get('2026-10-06').map((e) => e.id), ['a']);
  assert.deepEqual(map.get('2026-10-01').map((e) => e.id), ['b']);
  assert.equal(map.get('2026-09-30'), undefined);
  assert.deepEqual(map.get('2026-10-09').map((e) => e.id), ['c']);
  assert.equal(eachDay('2026-10-01', '2026-10-03').length, 3);
});

test('dateRange', () => {
  assert.equal(dateRange('2026-03-02', '2026-03-02'), '2 Mar 2026');
  assert.equal(dateRange('2026-03-02', '2026-03-06'), '2 Mar - 6 Mar 2026');
  assert.equal(dateRange('2026-12-29', '2027-01-02'), '29 Dec 2026 - 2 Jan 2027');
});
