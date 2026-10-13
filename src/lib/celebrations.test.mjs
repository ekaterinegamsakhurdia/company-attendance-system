import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceDetailed, averageAge, averageService, celebrationDate, celebrationEvents, fullYears, missingDates, nextOccurrence, serviceText, teamCount, upcomingCelebrations } from './celebrations.js';

const emp = (id, first, extra = {}) => ({ id, first_name: first, last_name: 'Test', is_active: true, role: 'employee', department_id: null, ...extra });

test('29 February is celebrated on 28 February in common years', () => {
  assert.equal(celebrationDate('2000-02-29', 2027), '2027-02-28');
  assert.equal(celebrationDate('2000-02-29', 2028), '2028-02-29');
  assert.equal(celebrationDate('1990-07-04', 2030), '2030-07-04');
});

test('nextOccurrence rolls into next year after the date has passed', () => {
  assert.deepEqual(nextOccurrence('1990-10-13', '2026-10-13'), { date: '2026-10-13', daysUntil: 0 });
  assert.deepEqual(nextOccurrence('1990-10-12', '2026-10-13'), { date: '2027-10-12', daysUntil: 364 });
  assert.equal(nextOccurrence('1992-02-29', '2026-10-13').date, '2027-02-28');
});

test('fullYears and serviceText', () => {
  assert.equal(fullYears('1990-10-14', '2026-10-13'), 35);
  assert.equal(fullYears('1990-10-13', '2026-10-13'), 36);
  assert.equal(serviceText('2023-08-13', '2026-10-13'), '3 years 2 months');
  assert.equal(serviceText('2026-09-20', '2026-10-13'), '0 months');
  assert.equal(serviceText('2025-10-13', '2026-10-13'), '1 year');
  assert.equal(serviceText(null, '2026-10-13'), '-');
});

test('upcoming birthdays and anniversaries are sorted and skip inactive people and the first year', () => {
  const employees = [emp('a', 'Ann'), emp('b', 'Bob'), emp('c', 'Cy', { is_active: false }), emp('d', 'Di'), emp('e', 'Eve')];
  const profiles = [
    { employee_id: 'a', birth_date: '1990-10-20', hire_date: '2020-10-14' },
    { employee_id: 'b', birth_date: '1985-10-13', hire_date: '2026-03-01' },
    { employee_id: 'c', birth_date: '1980-10-14', hire_date: '2010-10-14' },
    { employee_id: 'd', birth_date: '1992-02-29', hire_date: '2026-10-20' },
  ];
  const today = '2026-10-13';
  const birthdays = upcomingCelebrations({ employees, profiles, kind: 'birthday', today });
  assert.deepEqual(birthdays.map((b) => b.name), ['Bob Test', 'Ann Test', 'Di Test']);
  assert.equal(birthdays[0].daysUntil, 0);
  assert.equal(birthdays[0].years, 41);
  const soon = upcomingCelebrations({ employees, profiles, kind: 'birthday', today, withinDays: 30 });
  assert.deepEqual(soon.map((b) => b.name), ['Bob Test', 'Ann Test']);
  const anniversaries = upcomingCelebrations({ employees, profiles, kind: 'anniversary', today });
  assert.deepEqual(anniversaries.map((a) => [a.name, a.years]), [['Ann Test', 6], ['Bob Test', 1]]);   // Bob's first one is next March; Di has not started yet
});

test('celebrationEvents for a calendar window', () => {
  const employees = [emp('a', 'Ann')];
  const profiles = [{ employee_id: 'a', birth_date: '1990-10-20', hire_date: '2020-10-14' }];
  const events = celebrationEvents({ employees, profiles, from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(events.map((e) => [e.kind, e.start]), [['birthday', '2026-10-20'], ['anniversary', '2026-10-14']]);
  assert.match(events[1].title, /6 years/);
  const wide = celebrationEvents({ employees, profiles, from: '2026-12-15', to: '2027-01-15' });
  assert.equal(wide.length, 0);
  const none = celebrationEvents({ employees, profiles, from: '2020-10-01', to: '2020-10-31' });
  assert.deepEqual(none.map((e) => e.kind), ['birthday']);   // the hire day itself is not an anniversary
});

test('averages ignore people without dates and inactive accounts', () => {
  const employees = [emp('a', 'Ann'), emp('b', 'Bob'), emp('c', 'Cy', { is_active: false }), emp('d', 'Di')];
  const profiles = [
    { employee_id: 'a', birth_date: '1996-10-13', hire_date: '2024-10-13' },
    { employee_id: 'b', birth_date: '1976-10-13', hire_date: '2022-10-13' },
    { employee_id: 'c', birth_date: '1950-01-01', hire_date: '2000-01-01' },
  ];
  const today = '2026-10-13';
  assert.deepEqual(averageAge({ employees, profiles, today }), { value: 40, counted: 2 });
  assert.deepEqual(averageService({ employees, profiles, today }), { value: 3, counted: 2 });
  assert.deepEqual(averageAge({ employees: [emp('z', 'Zed')], profiles: [], today }), { value: null, counted: 0 });
});

test('teamCount and missingDates', () => {
  const employees = [emp('a', 'Ann', { department_id: 'd1' }), emp('b', 'Bob', { department_id: 'd1' }), emp('c', 'Cy', { role: 'ceo' }), emp('x', 'Gone', { is_active: false })];
  const departments = [{ id: 'd1', name: 'Design' }];
  const t = teamCount({ employees, departments });
  assert.equal(t.total, 3);
  assert.deepEqual(t.byDepartment, [{ name: 'Design', count: 2 }, { name: 'No department', count: 1 }]);
  const m = missingDates({ employees, profiles: [{ employee_id: 'a', birth_date: '1990-01-01', hire_date: null }] });
  assert.deepEqual(m.map((x) => [x.employee.id, x.birth, x.hire]), [['a', false, true], ['b', true, true], ['c', true, true]]);
});

test('serviceDetailed gives years, months and days', () => {
  assert.equal(serviceDetailed('2025-02-17', '2026-10-13'), '1 year 7 months 26 days');
  assert.equal(serviceDetailed('2025-02-17', '2026-10-11'), '1 year 7 months 24 days');
  assert.equal(serviceDetailed('2026-10-13', '2026-10-13'), '0 days');
  assert.equal(serviceDetailed('2026-10-01', '2026-10-13'), '12 days');
  assert.equal(serviceDetailed('2024-10-13', '2026-10-13'), '2 years');
  assert.equal(serviceDetailed('2026-01-31', '2026-03-01'), '1 month 1 day');
  assert.equal(serviceDetailed('2026-11-01', '2026-10-13'), '-');
  assert.equal(serviceDetailed(null, '2026-10-13'), '-');
});
