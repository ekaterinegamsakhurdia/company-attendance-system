// Filters shared by the report views (timesheet, records, leaves).

export const NO_TEAM = '__none__'; // CEOs and developers belong to no department

/** The person who normally approves this person's leave: their chosen approver, else the department head, else null (= any CEO). */
export function effectiveApproverId(person, profile, departments) {
  if (profile?.approver_id) return profile.approver_id;
  const dept = departments.find((d) => d.id === person.department_id);
  return dept?.head_employee_id && dept.head_employee_id !== person.id ? dept.head_employee_id : null;
}

/** Everyone who may approve: active CEOs, developers and department heads. */
export function approverOptions(employees, departments) {
  const heads = new Set(departments.map((d) => d.head_employee_id).filter(Boolean));
  return employees
    .filter((e) => e.is_active && (e.role !== 'employee' || heads.has(e.id)))
    .map((e) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Narrows people by employee, team and approver. Empty selections mean "everyone".
 * A person with no named approver is approved by any CEO / developer, so they match when a CEO / developer is selected.
 */
export function filterPeople({ employees, profiles = new Map(), departments, employeeIds = [], teamIds = [], approverIds = [] }) {
  const byId = new Map(employees.map((e) => [e.id, e]));
  return employees.filter((e) => {
    if (employeeIds.length && !employeeIds.includes(e.id)) return false;
    if (teamIds.length && !teamIds.includes(e.department_id ?? NO_TEAM)) return false;
    if (approverIds.length) {
      const id = effectiveApproverId(e, profiles.get(e.id), departments);
      const matches = id ? approverIds.includes(id) : approverIds.some((a) => byId.get(a) && byId.get(a).role !== 'employee');
      if (!matches) return false;
    }
    return true;
  });
}

export const hasFilters = (f) => Boolean(f.employeeIds.length || f.teamIds.length || f.approverIds.length);
