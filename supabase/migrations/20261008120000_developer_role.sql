-- =====================================================================
-- Looper Agency, migration 3
--   1. New account type: developer (full control, hidden from the CEO's lists)
--   2. Developer-only RPCs: change account type, edit employee data,
--      delete departments / job roles
--   3. New employees must have a department, and a job role whenever the
--      department has job roles (enforced in the database)
--   4. Department + job role are changed together (no "none" for roles
--      that exist), and CEOs cannot touch developer accounts
--
-- is_ceo() now means "has admin rights" (CEO or developer), so every
-- existing CEO policy and RPC also works for a developer without changes.
-- Use is_developer() for things only a developer may do.
--
-- Safe to run once on a database that already has migrations 1 and 2.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Account types
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  -- The original check constraint is unnamed, so find it by what it checks.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.employees'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mrole\M'
  loop
    execute format('alter table public.employees drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.employees
  add constraint employees_role_chk check (role in ('employee', 'ceo', 'developer'));

create or replace function public.is_developer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_user_id = auth.uid()
      and e.role = 'developer'
      and e.is_active
  );
$$;

-- "Admin rights": CEO or developer.
create or replace function public.is_ceo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_user_id = auth.uid()
      and e.role in ('ceo', 'developer')
      and e.is_active
  );
$$;

-- Developer accounts are invisible to everyone except developers (and themselves).
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_developer()
    or (
      role <> 'developer'
      and (
        public.is_ceo()
        or (department_id is not null and department_id = public.head_department_id())
      )
    )
  );

-- ---------------------------------------------------------------------
-- 2. Rules for department + job role
-- ---------------------------------------------------------------------
-- Validates a department / job role pair. Used by every function that sets them.
create or replace function public.assert_org_assignment(
  p_account_role text,
  p_department_id uuid,
  p_job_role_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  dept_active boolean;
  role_dept uuid;
  role_active boolean;
  dept_has_roles boolean;
begin
  if p_department_id is null then
    if p_account_role = 'employee' then
      raise exception 'Choose a department.' using errcode = '22023';
    end if;
    if p_job_role_id is not null then
      raise exception 'A job role needs a department.' using errcode = '22023';
    end if;
    return;
  end if;

  select is_active into dept_active from public.departments where id = p_department_id;
  if not found then
    raise exception 'Department not found.' using errcode = 'P0002';
  end if;
  if not dept_active then
    raise exception 'This department is inactive.' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.job_roles j where j.department_id = p_department_id and j.is_active
  ) into dept_has_roles;

  if p_job_role_id is null then
    if p_account_role = 'employee' and dept_has_roles then
      raise exception 'Choose a job role for this department.' using errcode = '22023';
    end if;
    return;
  end if;

  select department_id, is_active into role_dept, role_active
  from public.job_roles where id = p_job_role_id;
  if not found then
    raise exception 'Job role not found.' using errcode = 'P0002';
  end if;
  if role_dept <> p_department_id then
    raise exception 'This job role belongs to a different department.' using errcode = '22023';
  end if;
  if not role_active then
    raise exception 'This job role is inactive.' using errcode = '22023';
  end if;
end;
$$;

-- Every new employee must have a department (and a job role if the department has any).
-- Only inserts are checked, so employees that already exist are left alone.
create or replace function public.employees_require_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'employee' then
    perform public.assert_org_assignment(new.role, new.department_id, new.job_role_id);
  end if;
  return new;
end;
$$;

drop trigger if exists employees_require_org_trg on public.employees;
create trigger employees_require_org_trg
  before insert on public.employees
  for each row execute function public.employees_require_org();

-- A CEO may not change a developer account (they cannot see it either).
create or replace function public.assert_can_manage_employee(p_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_role text;
begin
  select role into target_role from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if target_role = 'developer' and not public.is_developer() then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  return target_role;
end;
$$;

-- Department and job role now change together.
drop function if exists public.ceo_set_employee_department(uuid, uuid);

create or replace function public.ceo_set_employee_department(
  p_employee_id uuid,
  p_department_id uuid,
  p_job_role_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct_role text;
  old_dept uuid;
  old_job uuid;
begin
  if not public.is_ceo() then
    raise exception 'Only the CEO can change departments.' using errcode = '42501';
  end if;

  acct_role := public.assert_can_manage_employee(p_employee_id);
  select department_id, job_role_id into old_dept, old_job from public.employees where id = p_employee_id;

  -- An unchanged department keeps working with the same validation (job role may still be added).
  perform public.assert_org_assignment(acct_role, p_department_id, p_job_role_id);

  update public.employees
     set department_id = p_department_id,
         job_role_id = p_job_role_id
   where id = p_employee_id;

  perform public.log_audit('employee.department', p_employee_id, 'Department changed',
    jsonb_build_object(
      'old_department_id', old_dept, 'new_department_id', p_department_id,
      'old_job_role_id', old_job, 'new_job_role_id', p_job_role_id));
end;
$$;

create or replace function public.ceo_set_employee_job_role(p_employee_id uuid, p_job_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct_role text;
  emp_dept uuid;
  old_role uuid;
begin
  if not public.is_ceo() then
    raise exception 'Only the CEO can change job roles.' using errcode = '42501';
  end if;

  acct_role := public.assert_can_manage_employee(p_employee_id);
  select department_id, job_role_id into emp_dept, old_role from public.employees where id = p_employee_id;

  perform public.assert_org_assignment(acct_role, emp_dept, p_job_role_id);

  update public.employees set job_role_id = p_job_role_id where id = p_employee_id;

  perform public.log_audit('employee.job_role', p_employee_id, 'Job role changed',
    jsonb_build_object('old_job_role_id', old_role, 'new_job_role_id', p_job_role_id));
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Developer-only RPCs
-- ---------------------------------------------------------------------
-- Change an account type: employee <-> ceo <-> developer.
create or replace function public.dev_set_employee_role(p_employee_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_role text;
  target_auth uuid;
begin
  if not public.is_developer() then
    raise exception 'Only a developer can change account types.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('employee', 'ceo', 'developer') then
    raise exception 'Unknown account type.' using errcode = '22023';
  end if;

  select role, auth_user_id into old_role, target_auth from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if target_auth is not null and target_auth = auth.uid() then
    raise exception 'You cannot change your own account type.' using errcode = '22023';
  end if;
  if old_role = p_role then
    return;
  end if;

  if p_role = 'developer' then
    -- Developers belong to no department.
    update public.employees
       set role = p_role, department_id = null, job_role_id = null
     where id = p_employee_id;
  else
    update public.employees set role = p_role where id = p_employee_id;
  end if;

  perform public.log_audit('employee.role', p_employee_id, 'Account type changed',
    jsonb_build_object('old_role', old_role, 'new_role', p_role));
end;
$$;

-- Edit an employee's data in one go.
create or replace function public.dev_update_employee(
  p_employee_id uuid,
  p_employee_number text,
  p_first_name text,
  p_last_name text,
  p_department_id uuid,
  p_job_role_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.employees;
begin
  if not public.is_developer() then
    raise exception 'Only a developer can edit employee data.' using errcode = '42501';
  end if;

  select * into before_row from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if before_row.auth_user_id is not null and before_row.auth_user_id = auth.uid() and not p_is_active then
    raise exception 'You cannot deactivate your own account.' using errcode = '22023';
  end if;

  if p_employee_number is null or length(trim(p_employee_number)) not between 1 and 32 then
    raise exception 'Employee number is required (max 32 characters).' using errcode = '22023';
  end if;
  if p_first_name is null or length(trim(p_first_name)) not between 1 and 100
     or p_last_name is null or length(trim(p_last_name)) not between 1 and 100 then
    raise exception 'First and last name are required.' using errcode = '22023';
  end if;

  -- Developers keep no department; everyone else follows the department / job role rules.
  if before_row.role = 'developer' then
    p_department_id := null;
    p_job_role_id := null;
  else
    -- An inactive person may keep a department that was deactivated later.
    if p_department_id is distinct from before_row.department_id or p_is_active then
      perform public.assert_org_assignment(before_row.role, p_department_id, p_job_role_id);
    end if;
  end if;

  begin
    update public.employees
       set employee_number = trim(p_employee_number),
           first_name = trim(p_first_name),
           last_name = trim(p_last_name),
           department_id = p_department_id,
           job_role_id = p_job_role_id,
           is_active = p_is_active
     where id = p_employee_id;
  exception when unique_violation then
    raise exception 'That employee number is already used.' using errcode = '23505';
  end;

  perform public.log_audit('employee.update', p_employee_id, 'Employee data edited by a developer',
    jsonb_build_object(
      'old', jsonb_build_object('employee_number', before_row.employee_number, 'first_name', before_row.first_name,
        'last_name', before_row.last_name, 'department_id', before_row.department_id,
        'job_role_id', before_row.job_role_id, 'is_active', before_row.is_active),
      'new', jsonb_build_object('employee_number', trim(p_employee_number), 'first_name', trim(p_first_name),
        'last_name', trim(p_last_name), 'department_id', p_department_id,
        'job_role_id', p_job_role_id, 'is_active', p_is_active)));
end;
$$;

-- Remove a department that has nobody in it (its job roles go with it).
create or replace function public.dev_delete_department(p_department_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.is_developer() then
    raise exception 'Only a developer can delete departments.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'Department not found.' using errcode = 'P0002';
  end if;

  select count(*) into n from public.employees where department_id = p_department_id;
  if n > 0 then
    raise exception '% employee(s) still belong to this department. Move them first, or deactivate the department instead.', n
      using errcode = '23503';
  end if;

  delete from public.departments where id = p_department_id;   -- audited by trigger
end;
$$;

-- Remove a job role nobody holds.
create or replace function public.dev_delete_job_role(p_job_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.is_developer() then
    raise exception 'Only a developer can delete job roles.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.job_roles where id = p_job_role_id) then
    raise exception 'Job role not found.' using errcode = 'P0002';
  end if;

  select count(*) into n from public.employees where job_role_id = p_job_role_id;
  if n > 0 then
    raise exception '% employee(s) still hold this job role. Change their role first, or deactivate it instead.', n
      using errcode = '23503';
  end if;

  delete from public.job_roles where id = p_job_role_id;   -- audited by trigger
end;
$$;

-- Job role deletions were not audited before.
drop trigger if exists job_roles_audit_trg on public.job_roles;
create trigger job_roles_audit_trg
  after insert or update or delete on public.job_roles
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------
revoke all on function public.is_developer()                                   from public, anon;
revoke all on function public.assert_org_assignment(text, uuid, uuid)          from public, anon, authenticated;
revoke all on function public.assert_can_manage_employee(uuid)                 from public, anon, authenticated;
revoke all on function public.employees_require_org()                          from public, anon, authenticated;
revoke all on function public.ceo_set_employee_department(uuid, uuid, uuid)    from public, anon;
revoke all on function public.ceo_set_employee_job_role(uuid, uuid)            from public, anon;
revoke all on function public.dev_set_employee_role(uuid, text)                from public, anon;
revoke all on function public.dev_update_employee(uuid, text, text, text, uuid, uuid, boolean) from public, anon;
revoke all on function public.dev_delete_department(uuid)                      from public, anon;
revoke all on function public.dev_delete_job_role(uuid)                        from public, anon;

grant execute on function public.is_developer()                                to authenticated;
grant execute on function public.ceo_set_employee_department(uuid, uuid, uuid) to authenticated;
grant execute on function public.ceo_set_employee_job_role(uuid, uuid)         to authenticated;
grant execute on function public.dev_set_employee_role(uuid, text)             to authenticated;
grant execute on function public.dev_update_employee(uuid, text, text, text, uuid, uuid, boolean) to authenticated;
grant execute on function public.dev_delete_department(uuid)                   to authenticated;
grant execute on function public.dev_delete_job_role(uuid)                     to authenticated;

commit;
