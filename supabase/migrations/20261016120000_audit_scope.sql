-- =====================================================================
-- Migration 7: who may read which audit rows
--
--   * A developer sees the whole audit log.
--   * A CEO sees only the IMPORTANT entries (people invited or removed, account
--     type / department / job role / department-head changes, departments, job
--     roles and networks created or removed, company settings, attendance
--     corrections, cancelled leaves) and never the entries written by a developer.
--     Routine noise (leave requests and decisions, automatic clock-outs, devices,
--     profile edits, holidays, allowances) stays out of the CEO's list.
--   * Everybody else sees nothing (as before).
--
-- Rows are not changed or deleted; only the read policy is replaced.
-- Safe to run more than once, on a database that has migrations 1-6.
-- =====================================================================

begin;

create or replace function public.audit_is_important(p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action = any (array[
    'employee.invite', 'employee.delete', 'employee.role', 'employee.department', 'employee.job_role',
    'department.head', 'departments.insert', 'departments.delete',
    'job_roles.insert', 'job_roles.delete',
    'allowed_networks.insert', 'allowed_networks.delete',
    'company_settings.update',
    'attendance.create', 'attendance.update', 'attendance.delete',
    'leave.cancel'
  ]);
$$;

create or replace function public.audit_log_visible(p_action text, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_developer()
      or (
        public.is_ceo()
        and public.audit_is_important(p_action)
        and not exists (
          select 1 from public.employees e
          where p_actor is not null and e.auth_user_id = p_actor and e.role = 'developer'
        )
      );
$$;

revoke all on function public.audit_is_important(text)        from public, anon;
revoke all on function public.audit_log_visible(text, uuid)   from public, anon;
grant execute on function public.audit_is_important(text)      to authenticated;
grant execute on function public.audit_log_visible(text, uuid)  to authenticated;

drop policy if exists audit_logs_ceo_select on public.audit_logs;
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.audit_log_visible(action, actor_user_id));

commit;
