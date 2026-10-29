// Leave rules mirrored from the database, used for previews and form checks.
// The database is the authority: it re-checks everything when a request is saved.
import { addDays, isWeekend } from './calendar.js';

export const CATEGORIES = [
  { id: 'vacation', label: 'Vacation', short: 'Vacation' },
  { id: 'unpaid', label: 'Unpaid leave', short: 'Unpaid' },
  { id: 'day_off', label: 'Day off', short: 'Day off' },
];

export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const statusLabel = (s) => STATUS_LABELS[s] ?? s;

/** Pill tone for a status (see .la-pill in app.css). */
export function statusTone(s) {
  if (s === 'approved') return 'ok';
  if (s === 'pending') return 'warn';
  return 'off';
}

/** Mon-Fri days in [start, end] that are not public holidays. `holidays` is a Set of 'YYYY-MM-DD'. */
export function workingDays(start, end, holidays = new Set()) {
  if (!start || !end || end < start) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isWeekend(d) && !holidays.has(d)) n += 1;
  }
  return n;
}

/** Working days of [start, end] that fall in `year`. */
export function workingDaysInYear(start, end, year, holidays = new Set()) {
  const from = start > `${year}-01-01` ? start : `${year}-01-01`;
  const to = end < `${year}-12-31` ? end : `${year}-12-31`;
  return workingDays(from, to, holidays);
}

/** Upcoming = not finished yet (any status); past = already over. Both lists are sorted. */
export function splitLeaves(leaves, today) {
  const upcoming = leaves.filter((l) => l.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const past = leaves.filter((l) => l.end_date < today).sort((a, b) => b.start_date.localeCompare(a.start_date));
  return { upcoming, past };
}

/** Is `today` inside an approved leave? */
export const isOnLeaveToday = (leave, today) =>
  leave.status === 'approved' && leave.start_date <= today && leave.end_date >= today;

/** Can the employee cancel their own leave? (The database enforces the same rule.) */
export function canCancelOwn(leave, today) {
  if (leave.status === 'pending') return true;
  return leave.status === 'approved' && leave.start_date > today;
}

/**
 * Can this person approve / reject the request?
 * `me` = { id, role }; `headDepartment` = the department they head ({ id, approves_all_leaves }) or null.
 * A CEO / developer decides everything, a head their own department, and the head of a department that
 * "approves leaves company-wide" every request the database shows them (it only shows employees' leaves).
 * Passing just a department id (older callers) still works.
 */
export function canDecide(leave, me, headDepartment) {
  if (leave.status !== 'pending' || leave.employee_id === me.id) return false;
  if (me.role === 'ceo' || me.role === 'developer') return true;
  const dept = headDepartment && typeof headDepartment === 'object' ? headDepartment : { id: headDepartment };
  if (!dept.id) return false;
  return Boolean(dept.approves_all_leaves) || leave.department_id === dept.id;
}

/** Returns a message for the first problem found, or '' when the form can be sent. */
export function validateLeaveForm({ category, start, end, approverId, replacementId, replacementRequired, today }) {
  if (!category) return 'Choose a leave type.';
  if (!start || !end) return 'Choose a start and an end date.';
  if (end < start) return 'The end date cannot be before the start date.';
  if (today && start < today) return 'The start date cannot be in the past.';
  if (!approverId) return 'Choose who should approve this leave.';
  if (replacementRequired && !replacementId) return 'Choose a replacement from your department.';
  return '';
}

/** Turns [{ category, allowance, used, pending, remaining }] into an object keyed by category. */
export function balanceMap(rows) {
  return Object.fromEntries((rows ?? []).map((r) => [r.category, r]));
}

/** Groups the flat leave_balances_all rows by employee: Map<employeeId, { category: row }>. */
export function groupBalances(rows) {
  const map = new Map();
  for (const r of rows ?? []) {
    if (!map.has(r.employee_id)) map.set(r.employee_id, {});
    map.get(r.employee_id)[r.category] = r;
  }
  return map;
}
