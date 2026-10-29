-- Looper Agency, migration 14: a department head who approves leaves for the whole company
--
--   Until now a department head could only see and decide the leaves of their own department.
--   The head of Account Managers has to approve everybody's vacation / unpaid leave / days off
--   (all other heads and all employees), so a department can now be marked
--   "approves leaves company-wide". Its head then:
--     * can be chosen as the approver by every employee (CEOs and developers still use CEOs / developers),
--     * sees and decides the leaves of every employee, cancels them with a reason, sees their balances,
--     * can read the employee list (names, departments) so the calendar and the team grid can show everybody.
--   Nothing else changes: CEOs, developers and their data stay out of reach, nobody decides their own
--   leave, and attendance, reports, birthdays and settings stay with the CEO / the department head.
--   Only a CEO or developer can switch the mark on or off (Settings -> Departments).
begin;

alter table public.departments
  add column if not exists approves_all_leaves boolean not null default false;

-- The department that exists since the first migration.
update public.departments set approves_all_leaves = true where lower(name) = 'account managers';

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------
create or replace function public.is_org_leave_approver(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee_id is not null and exists (
    select 1 from public.departments d
     where d.head_employee_id = p_employee_id and d.approves_all_leaves and d.is_active
  );
$$;

create or replace function public.approves_all_leaves()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_org_leave_approver(public.current_employee_id());
$$;

-- May the signed-in person decide / cancel / look at this person's leaves?
-- CEO or developer: anyone. Department head: their department. Company-wide approver: every employee
-- (role 'employee', which includes department heads; never a CEO or a developer).
create or replace function public.can_manage_leaves_of(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_ceo()
      or public.in_my_headed_department(p_employee_id)
      or (public.approves_all_leaves()
          and exists (select 1 from public.employees e where e.id = p_employee_id and e.role = 'employee'));
$$;

revoke all on function public.is_org_leave_approver(uuid) from public, anon;
revoke all on function public.approves_all_leaves()       from public, anon;
revoke all on function public.can_manage_leaves_of(uuid)  from public, anon;
grant execute on function public.is_org_leave_approver(uuid) to authenticated;
grant execute on function public.approves_all_leaves()       to authenticated;
grant execute on function public.can_manage_leaves_of(uuid)  to authenticated;

-- ---------------------------------------------------------------------
-- row level security: leaves and the employee list
-- ---------------------------------------------------------------------
drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.can_manage_leaves_of(employee_id));

drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_ceo()                                   -- CEO or developer
    or (department_id is not null and department_id = public.head_department_id())
    or (role = 'employee' and public.approves_all_leaves())
  );

-- ---------------------------------------------------------------------
-- who may look at a person's leave data
-- ---------------------------------------------------------------------
create or replace function public.assert_can_view_leaves(p_employee_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_employee_id is distinct from public.current_employee_id()
     and not public.can_manage_leaves_of(p_employee_id) then
    raise exception 'You cannot see this person''s leaves.' using errcode = '42501';
  end if;
end;
$$;

-- Everyone's balances (analytics): CEO / developer all, a head their department, a company-wide approver every employee.
create or replace function public.leave_balances_all(p_year int)
returns table (employee_id uuid, category text, allowance int, used int, pending int, remaining int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_ceo() and public.head_department_id() is null and not public.approves_all_leaves() then
    raise exception 'Only a CEO, developer or department head can see everyone''s balances.' using errcode = '42501';
  end if;
  return query
    select e.id, c.category,
           public.leave_allowance_for(e.id, p_year, c.category),
           public.leave_used_days(e.id, p_year, c.category, 'approved'),
           public.leave_used_days(e.id, p_year, c.category, 'pending'),
           public.leave_allowance_for(e.id, p_year, c.category)
             - public.leave_used_days(e.id, p_year, c.category, 'approved')
             - public.leave_used_days(e.id, p_year, c.category, 'pending')
    from public.employees e
    cross join (values ('vacation', 1), ('unpaid', 2), ('day_off', 3)) as c(category, ord)
    where e.is_active
      and (public.is_ceo()
           or (e.department_id is not null and e.department_id = public.head_department_id())
           or (e.role = 'employee' and public.approves_all_leaves()))
    order by e.employee_number, c.ord;
end;
$$;

-- ---------------------------------------------------------------------
-- the request form: the company-wide approver is offered to everybody
-- ---------------------------------------------------------------------
create or replace function public.leave_form_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.employees;
  approvers jsonb;
  replacements jsonb := '[]'::jsonb;
  pref uuid;
  default_approver uuid;
begin
  select * into me from public.employees where auth_user_id = auth.uid() and is_active;
  if not found then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;

  if me.role in ('ceo', 'developer') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', e.id, 'name', e.first_name || ' ' || e.last_name,
             'kind', case e.role when 'ceo' then 'CEO' else 'Developer' end)
             order by e.role, e.first_name), '[]'::jsonb)
      into approvers
      from public.employees e
     where e.is_active and e.role in ('ceo', 'developer') and e.id <> me.id;
  else
    select coalesce(jsonb_agg(x.j order by x.ord, x.name), '[]'::jsonb)
      into approvers
      from (
        select jsonb_build_object('id', e.id, 'name', e.first_name || ' ' || e.last_name, 'kind', 'Department head') as j,
               1 as ord, e.first_name as name
          from public.departments d
          join public.employees e on e.id = d.head_employee_id and e.is_active
         where d.id = me.department_id and e.id <> me.id
        union all
        select jsonb_build_object('id', e.id, 'name', e.first_name || ' ' || e.last_name, 'kind', 'CEO'), 2, e.first_name
          from public.employees e
         where e.is_active and e.role = 'ceo' and e.id <> me.id
        union all
        select jsonb_build_object('id', e.id, 'name', e.first_name || ' ' || e.last_name, 'kind', d.name || ' head'), 3, e.first_name
          from public.departments d
          join public.employees e on e.id = d.head_employee_id and e.is_active
         where d.approves_all_leaves and d.is_active and e.id <> me.id
           and d.id is distinct from me.department_id
      ) x;

    if me.department_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.first_name || ' ' || e.last_name)
                                order by e.first_name, e.last_name), '[]'::jsonb)
        into replacements
        from public.employees e
       where e.is_active and e.role = 'employee' and e.department_id = me.department_id and e.id <> me.id;
    end if;
  end if;

  select p.approver_id into pref from public.employee_profiles p where p.employee_id = me.id;
  if pref is not null then
    select (a ->> 'id')::uuid into default_approver
      from jsonb_array_elements(approvers) a
     where (a ->> 'id')::uuid = pref
     limit 1;
  end if;

  return jsonb_build_object(
    'approvers', approvers,
    'replacements', replacements,
    'replacement_required', jsonb_array_length(replacements) > 0,
    'default_approver_id', default_approver
  );
end;
$$;

-- ---------------------------------------------------------------------
-- request_leave: the approver may also be a company-wide approver
-- ---------------------------------------------------------------------
create or replace function public.request_leave(
  p_category    text,
  p_start       date,
  p_end         date,
  p_comment     text,
  p_approver_id uuid,
  p_replacement_id uuid default null
)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.employees;
  approver public.employees;
  repl public.employees;
  colleagues int;
  days int;
  rec public.leave_requests;
begin
  select * into me from public.employees where auth_user_id = auth.uid() and is_active;
  if not found then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;
  if p_category is null or p_category not in ('vacation', 'unpaid', 'day_off') then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_comment is not null and length(p_comment) > 500 then
    raise exception 'The comment is too long (500 characters at most).' using errcode = '22023';
  end if;
  days := public.assert_leave_dates(p_start, p_end);

  -- who approves
  if p_approver_id is null then
    raise exception 'Choose who should approve this leave.' using errcode = '22023';
  end if;
  select * into approver from public.employees where id = p_approver_id and is_active;
  if not found or approver.id = me.id then
    raise exception 'Choose someone else to approve this leave.' using errcode = '22023';
  end if;
  if me.role in ('ceo', 'developer') then
    if approver.role not in ('ceo', 'developer') then
      raise exception 'A CEO or developer''s leave must be approved by another CEO or developer.' using errcode = '22023';
    end if;
  elsif not (
    approver.role = 'ceo'
    or exists (select 1 from public.departments d where d.id = me.department_id and d.head_employee_id = approver.id)
    or public.is_org_leave_approver(approver.id)
  ) then
    raise exception 'Leave must be approved by your department head or a CEO (or by a company-wide approver).' using errcode = '22023';
  end if;

  -- replacement (colleagues in the same department)
  if me.role = 'employee' and me.department_id is not null then
    select count(*) into colleagues
      from public.employees e
     where e.is_active and e.role = 'employee' and e.department_id = me.department_id and e.id <> me.id;
    if colleagues > 0 and p_replacement_id is null then
      raise exception 'Choose a replacement from your department.' using errcode = '22023';
    end if;
    if p_replacement_id is not null then
      select * into repl from public.employees where id = p_replacement_id;
      if not found or not repl.is_active or repl.id = me.id
         or repl.role <> 'employee' or repl.department_id is distinct from me.department_id then
        raise exception 'The replacement must be another active employee of your department.' using errcode = '22023';
      end if;
      if exists (select 1 from public.leave_requests x
                  where x.employee_id = repl.id and x.status = 'approved'
                    and x.start_date <= p_end and x.end_date >= p_start) then
        raise exception '% is on approved leave during these dates. Choose someone else.',
          repl.first_name || ' ' || repl.last_name using errcode = '22023';
      end if;
    end if;
  else
    p_replacement_id := null;      -- CEOs and developers have no department to cover for them
  end if;

  perform public.assert_no_leave_overlap(me.id, p_start, p_end);
  perform public.assert_leave_balance(me.id, p_category, p_start, p_end);

  insert into public.leave_requests (employee_id, category, start_date, end_date, comment, requested_approver_id, replacement_id)
  values (me.id, p_category, p_start, p_end, nullif(trim(coalesce(p_comment, '')), ''), approver.id, p_replacement_id)
  returning * into rec;

  perform public.log_audit('leave.request', me.id,
    'Requested ' || public.leave_category_label(p_category) || ' ' || p_start || ' to ' || p_end || ' (' || days || ' working days)',
    jsonb_build_object('leave_id', rec.id, 'category', p_category, 'start', p_start, 'end', p_end,
                       'working_days', days, 'approver_id', approver.id, 'replacement_id', p_replacement_id));
  return rec;
end;
$$;

-- ---------------------------------------------------------------------
-- decide_leave / cancel_leave
-- ---------------------------------------------------------------------
create or replace function public.decide_leave(p_leave_id uuid, p_decision text, p_comment text default null)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.employees;
  r public.leave_requests;
  rec public.leave_requests;
  y int;
begin
  select * into me from public.employees where auth_user_id = auth.uid() and is_active;
  if not found then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if p_comment is not null and length(p_comment) > 500 then
    raise exception 'The comment is too long (500 characters at most).' using errcode = '22023';
  end if;

  select * into r from public.leave_requests where id = p_leave_id for update;
  if not found then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if r.employee_id = me.id then
    raise exception 'You cannot decide your own leave request.' using errcode = '42501';
  end if;
  if not public.can_manage_leaves_of(r.employee_id) then
    raise exception 'Only a CEO, developer or the department head can decide this request.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request was already %.', r.status using errcode = '22023';
  end if;

  if p_decision = 'approved' and not public.is_developer() then
    -- allowances may have been lowered since the request was made
    for y in extract(year from r.start_date)::int .. extract(year from r.end_date)::int loop
      if public.leave_days_in_year(r.start_date, r.end_date, y) > 0
         and public.leave_used_days(r.employee_id, y, r.category, 'approved')
             + public.leave_days_in_year(r.start_date, r.end_date, y)
             > public.leave_allowance_for(r.employee_id, y, r.category) then
        raise exception 'Approving would exceed the % allowance for %.', public.leave_category_label(r.category), y
          using errcode = '22023';
      end if;
    end loop;
  end if;

  update public.leave_requests
     set status = p_decision,
         decided_by = me.id,
         decided_at = now(),
         decision_comment = nullif(trim(coalesce(p_comment, '')), '')
   where id = r.id
   returning * into rec;

  perform public.log_audit(case p_decision when 'approved' then 'leave.approve' else 'leave.reject' end, r.employee_id,
    (case p_decision when 'approved' then 'Approved ' else 'Rejected ' end)
      || public.leave_category_label(r.category) || ' ' || r.start_date || ' to ' || r.end_date,
    jsonb_build_object('leave_id', r.id, 'comment', rec.decision_comment));
  return rec;
end;
$$;

create or replace function public.cancel_leave(p_leave_id uuid, p_reason text default null)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.employees;
  r public.leave_requests;
  rec public.leave_requests;
  mine boolean;
begin
  select * into me from public.employees where auth_user_id = auth.uid() and is_active;
  if not found then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;
  select * into r from public.leave_requests where id = p_leave_id for update;
  if not found then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  mine := r.employee_id = me.id;

  if not (mine or public.can_manage_leaves_of(r.employee_id)) then
    raise exception 'You cannot cancel this leave.' using errcode = '42501';
  end if;
  if not mine then
    perform public.assert_can_change_leave_of(r.employee_id);
    if p_reason is null or length(trim(p_reason)) < 3 then
      raise exception 'A reason of at least 3 characters is required.' using errcode = '22023';
    end if;
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'This request is already %.', r.status using errcode = '22023';
  end if;
  if mine and r.status = 'approved' and r.start_date <= public.company_today() then
    raise exception 'A leave that has already started cannot be cancelled. Ask your CEO or department head.' using errcode = '22023';
  end if;

  update public.leave_requests
     set status = 'cancelled',
         decided_by = case when mine then decided_by else me.id end,
         decided_at = case when mine then decided_at else now() end,
         decision_comment = case when mine then decision_comment else trim(p_reason) end
   where id = r.id
   returning * into rec;

  perform public.log_audit('leave.cancel', r.employee_id,
    'Cancelled ' || public.leave_category_label(r.category) || ' ' || r.start_date || ' to ' || r.end_date
      || case when mine then '' else ': ' || trim(p_reason) end,
    jsonb_build_object('leave_id', r.id, 'by_owner', mine));
  return rec;
end;
$$;

-- ---------------------------------------------------------------------
-- list_leaves ('managed' scope)
-- ---------------------------------------------------------------------
drop function if exists public.list_leaves(text, date, date, text, uuid);

create or replace function public.list_leaves(
  p_scope text,
  p_from date default null,
  p_to date default null,
  p_status text default null,
  p_employee_id uuid default null
)
returns table (
  id uuid, employee_id uuid, employee_number text, employee_name text, department_id uuid,
  category text, start_date date, end_date date, working_days int, comment text, status text,
  approver_id uuid, approver_name text, replacement_id uuid, replacement_name text,
  decided_by_name text, decided_at timestamptz, decision_comment text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_employee_id();
begin
  if me is null then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;
  if p_scope not in ('mine', 'managed') then
    raise exception 'Unknown scope.' using errcode = '22023';
  end if;
  if p_scope = 'managed' and not public.is_ceo() and public.head_department_id() is null
     and not public.approves_all_leaves() then
    raise exception 'Only a CEO, developer or department head can list others'' leaves.' using errcode = '42501';
  end if;

  return query
    select r.id, r.employee_id, e.employee_number, e.first_name || ' ' || e.last_name, e.department_id,
           r.category, r.start_date, r.end_date, public.leave_working_days(r.start_date, r.end_date),
           r.comment, r.status,
           r.requested_approver_id, ap.first_name || ' ' || ap.last_name,
           r.replacement_id, rp.first_name || ' ' || rp.last_name,
           db.first_name || ' ' || db.last_name, r.decided_at, r.decision_comment, r.created_at
      from public.leave_requests r
      join public.employees e on e.id = r.employee_id
      left join public.employees ap on ap.id = r.requested_approver_id
      left join public.employees rp on rp.id = r.replacement_id
      left join public.employees db on db.id = r.decided_by
     where (p_from is null or r.end_date >= p_from)
       and (p_to   is null or r.start_date <= p_to)
       and (p_status is null or r.status = p_status)
       and (p_employee_id is null or r.employee_id = p_employee_id)
       and (
         (p_scope = 'mine' and r.employee_id = me)
         or (p_scope = 'managed' and (
               public.is_ceo()
               or (e.department_id is not null and e.department_id = public.head_department_id())
               or (e.role = 'employee' and public.approves_all_leaves())))
       )
     order by r.start_date desc, r.created_at desc;
end;
$$;

revoke all on function public.list_leaves(text, date, date, text, uuid) from public, anon;
grant execute on function public.list_leaves(text, date, date, text, uuid) to authenticated;

commit;
