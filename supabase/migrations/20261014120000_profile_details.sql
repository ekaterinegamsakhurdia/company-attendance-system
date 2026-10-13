-- =====================================================================
-- Looper Agency, migration 6: employee profile card
--
--   * employee_profiles gets: office, country, daily_hours (null = the
--     company's work day, work_end_time - work_start_time) and approver_id
--     (the person's usual approver; null = their department head, else a CEO).
--     All visible to the person themself and CEOs / developers only.
--   * set_employee_profile(): one function that saves all profile fields
--     (CEO / developer; only a developer for CEO / developer accounts).
--   * list_leaves() can be limited to one person (profile card).
--   * leave_form_options() pre-selects the person's usual approver.
--
-- Safe to run more than once, on a database that has migrations 1-5.
-- =====================================================================

begin;

alter table public.employee_profiles
  add column if not exists office       text check (office  is null or length(office)  <= 100),
  add column if not exists country      text check (country is null or length(country) <= 100),
  add column if not exists daily_hours  numeric(4,2) check (daily_hours is null or (daily_hours > 0 and daily_hours <= 24)),
  add column if not exists approver_id  uuid references public.employees(id) on delete set null;

-- ---------------------------------------------------------------------
-- Save every profile field at once
-- ---------------------------------------------------------------------
create or replace function public.set_employee_profile(
  p_employee_id  uuid,
  p_birth_date   date,
  p_hire_date    date,
  p_office       text,
  p_country      text,
  p_daily_hours  numeric,
  p_approver_id  uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.employees;
  appr public.employees;
  before_row public.employee_profiles;
  v_office text := nullif(trim(coalesce(p_office, '')), '');
  v_country text := nullif(trim(coalesce(p_country, '')), '');
begin
  perform public.assert_can_edit_profile_of(p_employee_id);
  select * into target from public.employees where id = p_employee_id;

  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > public.company_today()) then
    raise exception 'Birth date must be a real date in the past.' using errcode = '22023';
  end if;
  if p_hire_date is not null and (p_hire_date < date '1950-01-01' or p_hire_date > public.company_today() + 366) then
    raise exception 'Start date is not a valid date.' using errcode = '22023';
  end if;
  if v_office is not null and length(v_office) > 100 then
    raise exception 'The office name is too long (100 characters at most).' using errcode = '22023';
  end if;
  if v_country is not null and length(v_country) > 100 then
    raise exception 'The country name is too long (100 characters at most).' using errcode = '22023';
  end if;
  if p_daily_hours is not null and (p_daily_hours <= 0 or p_daily_hours > 24) then
    raise exception 'Working hours per day must be between 0 and 24.' using errcode = '22023';
  end if;

  if p_approver_id is not null then
    select * into appr from public.employees where id = p_approver_id and is_active;
    if not found or appr.id = target.id then
      raise exception 'Choose another active person as approver.' using errcode = '22023';
    end if;
    if appr.role not in ('ceo', 'developer')
       and not exists (select 1 from public.departments d
                        where d.head_employee_id = appr.id and d.id = target.department_id) then
      raise exception 'The approver must be a CEO, a developer or the head of this person''s department.' using errcode = '22023';
    end if;
  end if;

  select * into before_row from public.employee_profiles where employee_id = p_employee_id;
  insert into public.employee_profiles (employee_id, birth_date, hire_date, office, country, daily_hours, approver_id)
  values (p_employee_id, p_birth_date, p_hire_date, v_office, v_country, p_daily_hours, p_approver_id)
  on conflict (employee_id) do update
     set birth_date = excluded.birth_date, hire_date = excluded.hire_date, office = excluded.office,
         country = excluded.country, daily_hours = excluded.daily_hours, approver_id = excluded.approver_id;

  perform public.log_audit('employee.profile', p_employee_id, 'Profile details updated',
    jsonb_build_object('old', to_jsonb(before_row),
                       'new', jsonb_build_object('birth_date', p_birth_date, 'hire_date', p_hire_date, 'office', v_office,
                                                 'country', v_country, 'daily_hours', p_daily_hours, 'approver_id', p_approver_id)));
end;
$$;

revoke all on function public.set_employee_profile(uuid, date, date, text, text, numeric, uuid) from public, anon;
grant execute on function public.set_employee_profile(uuid, date, date, text, text, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- list_leaves(): optionally one person only
-- ---------------------------------------------------------------------
drop function if exists public.list_leaves(text, date, date, text);

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
  if p_scope = 'managed' and not public.is_ceo() and public.head_department_id() is null then
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
               or (e.department_id is not null and e.department_id = public.head_department_id())))
       )
     order by r.start_date desc, r.created_at desc;
end;
$$;

revoke all on function public.list_leaves(text, date, date, text, uuid) from public, anon;
grant execute on function public.list_leaves(text, date, date, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- leave_form_options(): also tells the form who the usual approver is
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

commit;
