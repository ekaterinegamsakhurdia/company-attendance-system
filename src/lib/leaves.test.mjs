import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceMap, canCancelOwn, canDecide, groupBalances, splitLeaves, validateLeaveForm, workingDays, workingDaysInYear } from './leaves.js';

test('working days skip weekends and holidays', () => {
  assert.equal(workingDays('2026-10-12', '2026-10-16'), 5);
  assert.equal(workingDays('2026-10-12', '2026-10-18'), 5);
  assert.equal(workingDays('2026-10-17', '2026-10-18'), 0);
  assert.equal(workingDays('2026-10-12', '2026-10-16', new Set(['2026-10-14'])), 4);
  assert.equal(workingDays('2026-10-16', '2026-10-12'), 0);
  // 2027-03-01..05 with 3 March (Mothers' Day) off is 4 days, as in the database tests
  assert.equal(workingDays('2027-03-01', '2027-03-05', new Set(['2027-03-03'])), 4);
});

test('a leave across New Year is split by year', () => {
  assert.equal(workingDaysInYear('2026-12-28', '2027-01-06', 2026), 4); // Mon 28 - Thu 31
  assert.equal(workingDaysInYear('2026-12-28', '2027-01-06', 2027), 4); // Fri 1 - Wed 6 minus weekend
});

test('splitLeaves puts finished leaves in the past', () => {
  const list = [
    { id: 1, start_date: '2026-11-02', end_date: '2026-11-06' },
    { id: 2, start_date: '2026-09-01', end_date: '2026-09-03' },
    { id: 3, start_date: '2026-10-12', end_date: '2026-10-14' },
    { id: 4, start_date: '2026-01-05', end_date: '2026-01-06' },
  ];
  const { upcoming, past } = splitLeaves(list, '2026-10-13');
  assert.deepEqual(upcoming.map((l) => l.id), [3, 1]);   // the one running today counts as upcoming / current
  assert.deepEqual(past.map((l) => l.id), [2, 4]);
});

test('cancel and decide rules', () => {
  assert.equal(canCancelOwn({ status: 'pending', start_date: '2026-01-01' }, '2026-10-13'), true);
  assert.equal(canCancelOwn({ status: 'approved', start_date: '2026-10-20' }, '2026-10-13'), true);
  assert.equal(canCancelOwn({ status: 'approved', start_date: '2026-10-13' }, '2026-10-13'), false);
  assert.equal(canCancelOwn({ status: 'rejected', start_date: '2026-10-20' }, '2026-10-13'), false);

  const leave = { status: 'pending', employee_id: 'e1', department_id: 'd1' };
  assert.equal(canDecide(leave, { id: 'c1', role: 'ceo' }, null), true);
  assert.equal(canDecide(leave, { id: 'dev', role: 'developer' }, null), true);
  assert.equal(canDecide(leave, { id: 'h1', role: 'employee' }, 'd1'), true);
  assert.equal(canDecide(leave, { id: 'h2', role: 'employee' }, 'd2'), false);
  assert.equal(canDecide(leave, { id: 'e2', role: 'employee' }, null), false);
  assert.equal(canDecide(leave, { id: 'e1', role: 'ceo' }, null), false);           // never your own
  assert.equal(canDecide({ ...leave, status: 'approved' }, { id: 'c1', role: 'ceo' }, null), false);
  // a head whose department approves company-wide decides every request they are shown, never their own
  const am = { id: 'd9', approves_all_leaves: true };
  assert.equal(canDecide(leave, { id: 'am', role: 'employee' }, am), true);
  assert.equal(canDecide({ ...leave, employee_id: 'am' }, { id: 'am', role: 'employee' }, am), false);
  assert.equal(canDecide(leave, { id: 'h2', role: 'employee' }, { id: 'd2', approves_all_leaves: false }), false);
  assert.equal(canDecide(leave, { id: 'h1', role: 'employee' }, { id: 'd1', approves_all_leaves: false }), true);
});

test('validateLeaveForm', () => {
  const ok = { category: 'vacation', start: '2026-10-20', end: '2026-10-22', approverId: 'a', replacementId: 'r', replacementRequired: true, today: '2026-10-13' };
  assert.equal(validateLeaveForm(ok), '');
  assert.match(validateLeaveForm({ ...ok, category: '' }), /type/);
  assert.match(validateLeaveForm({ ...ok, end: '2026-10-19' }), /end date/);
  assert.match(validateLeaveForm({ ...ok, start: '2026-10-01', end: '2026-10-02' }), /past/);
  assert.match(validateLeaveForm({ ...ok, approverId: '' }), /approve/);
  assert.match(validateLeaveForm({ ...ok, replacementId: '' }), /replacement/);
  assert.equal(validateLeaveForm({ ...ok, replacementId: '', replacementRequired: false }), '');
});

test('balance helpers', () => {
  const rows = [
    { employee_id: 'a', category: 'vacation', allowance: 24, used: 3, pending: 1, remaining: 20 },
    { employee_id: 'a', category: 'unpaid', allowance: 15, used: 0, pending: 0, remaining: 15 },
    { employee_id: 'b', category: 'vacation', allowance: 24, used: 0, pending: 0, remaining: 24 },
  ];
  assert.equal(balanceMap(rows.slice(0, 2)).vacation.remaining, 20);
  const grouped = groupBalances(rows);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('a').unpaid.allowance, 15);
});
