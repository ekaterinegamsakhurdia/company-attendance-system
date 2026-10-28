// The team grid: one row per person, one column per day, a coloured square for leave.
//   public holiday -> blue, vacation -> green, day off -> red, unpaid leave -> grey.
// A leave only colours the days it really takes: weekends and public holidays inside a leave are
// not leave days (the database does not count them either), so they keep the weekend / holiday look.
import { buildDays } from './timesheet.js';

export { buildDays };

/**
 * cell kinds: 'holiday', 'weekend', 'vacation' | 'unpaid' | 'day_off' (a leave day), or 'none'.
 * A leave cell has `pending: true` when the request is still waiting for a decision;
 * an approved leave wins over a pending one on the same day.
 * totals = approved leave days in the shown range, by type.
 */
export function buildLeaveGrid({ people, days, leaves }) {
  const byPerson = new Map();
  for (const l of leaves) {
    if (l.status !== 'approved' && l.status !== 'pending') continue;
    if (!byPerson.has(l.employee_id)) byPerson.set(l.employee_id, []);
    byPerson.get(l.employee_id).push(l);
  }

  return people.map((person) => {
    const mine = byPerson.get(person.id) ?? [];
    const totals = { vacation: 0, unpaid: 0, day_off: 0 };
    const cells = days.map((day) => {
      if (day.holiday) return { date: day.date, kind: 'holiday', title: day.holiday };
      if (day.weekend) return { date: day.date, kind: 'weekend' };
      let hit = null;
      for (const l of mine) {
        if (day.date < l.start_date || day.date > l.end_date) continue;
        if (!hit || (hit.status === 'pending' && l.status === 'approved')) hit = l;
      }
      if (!hit) return { date: day.date, kind: 'none' };
      const kind = ['vacation', 'unpaid', 'day_off'].includes(hit.category) ? hit.category : 'vacation';
      if (hit.status === 'approved') totals[kind] += 1;
      return { date: day.date, kind, pending: hit.status === 'pending', leave: hit };
    });
    return { person, cells, totals };
  });
}

/** Group rows by department, in the order of `departments`; people without one (CEOs, developers) come last. */
export function groupByDepartment(rows, departments) {
  const order = new Map(departments.map((d, i) => [d.id, i]));
  const groups = new Map();
  for (const row of rows) {
    const key = row.person.department_id && order.has(row.person.department_id) ? row.person.department_id : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const name = (r) => `${r.person.first_name} ${r.person.last_name}`;
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : order.get(a) - order.get(b)))
    .map(([id, list]) => ({
      id,
      name: id ? departments.find((d) => d.id === id).name : 'Leadership',
      rows: list.sort((x, y) => name(x).localeCompare(name(y))),
    }));
}
