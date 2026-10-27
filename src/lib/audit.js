// Which audit entries are "important" (mirrors public.audit_is_important in migration 7).
// The database decides what a CEO may read; this list is only used for the developer's filter.
export const IMPORTANT_ACTIONS = [
  'employee.create', 'employee.invite', 'employee.delete', 'employee.role', 'employee.department', 'employee.job_role',
  'department.head', 'departments.insert', 'departments.delete',
  'job_roles.insert', 'job_roles.delete',
  'allowed_networks.insert', 'allowed_networks.delete',
  'company_settings.update',
  'attendance.create', 'attendance.update', 'attendance.delete',
  'attendance.overtime',
  'leave.cancel',
];

export const isImportantAction = (action) => IMPORTANT_ACTIONS.includes(action);

/** Developer filter: id -> predicate(log, { actorIsDeveloper }). */
export const AUDIT_FILTERS = [
  { id: 'all', label: 'Everything', test: () => true },
  { id: 'important', label: 'Important only (what CEOs see)', test: (l, c) => isImportantAction(l.action) && !c.actorIsDeveloper },
  { id: 'developer', label: 'Made by developers', test: (l, c) => c.actorIsDeveloper },
  { id: 'people', label: 'People and structure', test: (l) => /^(employee|department|departments|job_roles|allowed_networks|company_settings)\./.test(l.action) },
  { id: 'attendance', label: 'Attendance', test: (l) => l.action.startsWith('attendance.') },
  { id: 'leaves', label: 'Leaves and holidays', test: (l) => /^(leave|holidays|public_holidays)\./.test(l.action) },
  { id: 'system', label: 'System and devices', test: (l) => !l.actor_user_id || l.action.startsWith('webauthn.') },
];
