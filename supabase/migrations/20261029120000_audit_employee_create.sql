-- =====================================================================
-- Looper Agency, migration 11: "employee.create" is an important audit entry
--
--   An employee can now be added first and invited later, so adding a person
--   and inviting them are two separate audit entries. CEOs read both.
--
-- Safe to run more than once, on a database that has migrations 1-10.
-- =====================================================================

begin;

create or replace function public.audit_is_important(p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action = any (array[
    'employee.create', 'employee.invite', 'employee.delete', 'employee.role', 'employee.department', 'employee.job_role',
    'department.head', 'departments.insert', 'departments.delete',
    'job_roles.insert', 'job_roles.delete',
    'allowed_networks.insert', 'allowed_networks.delete',
    'company_settings.update',
    'attendance.create', 'attendance.update', 'attendance.delete',
    'attendance.overtime',
    'leave.cancel'
  ]);
$$;

commit;
