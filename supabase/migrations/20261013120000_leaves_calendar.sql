-- =====================================================================
-- Looper Agency, migration 5: leaves, public holidays, birthdays / anniversaries
--
--   1. Leave requests with three categories (vacation, unpaid leave, day off),
--      a yearly allowance per category (company default 24 / 15 / 4, with an
--      optional per-person override), approval by the department head or a CEO
--      (a developer can also approve and can edit everything), a replacement
--      colleague, overlap and balance checks, all enforced here.
--   2. Public holidays, seeded with the Georgian ones for 2025-2040 (the
--      movable Orthodox Easter days are computed). CEO / developer can edit.
--   3. employee_profiles: birth date and hire date (birthdays, anniversaries,
--      average age and length of service). Visible to the person themself and
--      to CEOs / developers only.
--
-- Days are WORKING days: Monday to Friday, public holidays excluded.
-- Allowances are per calendar year and do not carry over. A request that
-- spans New Year is split by year. Pending requests reserve days.
--
-- Safe to run more than once, on a database that has migrations 1-4.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Company defaults
-- ---------------------------------------------------------------------
alter table public.company_settings
  add column if not exists leave_vacation_days int not null default 24 check (leave_vacation_days between 0 and 366),
  add column if not exists leave_unpaid_days   int not null default 15 check (leave_unpaid_days   between 0 and 366),
  add column if not exists leave_day_off_days  int not null default 4  check (leave_day_off_days  between 0 and 366);

create or replace function public.company_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select s.timezone from public.company_settings s where s.id = 1), 'UTC'))::date;
$$;

-- ---------------------------------------------------------------------
-- 2. Birth date / hire date
-- ---------------------------------------------------------------------
create table if not exists public.employee_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  birth_date  date check (birth_date is null or birth_date >= date '1900-01-01'),
  hire_date   date check (hire_date  is null or hire_date  >= date '1950-01-01'),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Public holidays
-- ---------------------------------------------------------------------
create table if not exists public.public_holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name         text not null check (length(trim(name)) between 1 and 100),
  is_official  boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (holiday_date, name)
);
create index if not exists public_holidays_date_idx on public.public_holidays (holiday_date);

-- Orthodox Easter Sunday (Gregorian date). Meeus' Julian algorithm + 13 days, valid 1900-2099.
create or replace function public.orthodox_easter(p_year int)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  a int; b int; c int; d int; e int; m int; dd int;
begin
  if p_year < 1900 or p_year > 2099 then
    raise exception 'Year must be between 1900 and 2099.' using errcode = '22023';
  end if;
  a := p_year % 4;
  b := p_year % 7;
  c := p_year % 19;
  d := (19 * c + 15) % 30;
  e := (2 * a + 4 * b - d + 34) % 7;
  m := (d + e + 114) / 31;
  dd := ((d + e + 114) % 31) + 1;
  return make_date(p_year, m, dd) + 13;
end;
$$;

-- Georgian public holidays (Labour Code list). Holidays are never moved when they
-- fall on a weekend. Idempotent; returns how many rows were added.
create or replace function public.seed_georgian_holidays(p_year int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  easter date := public.orthodox_easter(p_year);
  added int;
begin
  insert into public.public_holidays (holiday_date, name)
  values
    (make_date(p_year, 1, 1),   'New Year''s Day'),
    (make_date(p_year, 1, 2),   'Bedoba (New Year holiday)'),
    (make_date(p_year, 1, 7),   'Orthodox Christmas'),
    (make_date(p_year, 1, 19),  'Epiphany'),
    (make_date(p_year, 3, 3),   'Mother''s Day'),
    (make_date(p_year, 3, 8),   'International Women''s Day'),
    (make_date(p_year, 4, 9),   'National Unity Day'),
    (easter - 2,                'Orthodox Good Friday'),
    (easter - 1,                'Orthodox Holy Saturday'),
    (easter,                    'Orthodox Easter Sunday'),
    (easter + 1,                'Orthodox Easter Monday'),
    (make_date(p_year, 5, 9),   'Victory Day'),
    (make_date(p_year, 5, 12),  'St Andrew the First-Called Day'),
    (make_date(p_year, 5, 26),  'Independence Day'),
    (make_date(p_year, 8, 28),  'Mariamoba (Dormition of the Virgin)'),
    (make_date(p_year, 10, 14), 'Svetitskhovloba'),
    (make_date(p_year, 11, 23), 'St George''s Day (Giorgoba)')
  on conflict (holiday_date, name) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

-- Seed without writing 270 audit rows.
drop trigger if exists public_holidays_audit_trg on public.public_holidays;
do $$
declare y int;
begin
  for y in 2025..2040 loop
    perform public.seed_georgian_holidays(y);
  end loop;
end $$;
create trigger public_holidays_audit_trg
  after insert or update or delete on public.public_holidays
  for each row execute function public.audit_row_change();

-- CEO / developer button: "add the Georgian holidays for <year>".
create or replace function public.add_georgian_holidays(p_year int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  added int;
begin
  if not public.is_ceo() then
    raise exception 'Only a CEO or developer can manage holidays.' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2099 then
    raise exception 'Choose a year between 2000 and 2099.' using errcode = '22023';
  end if;
  added := public.seed_georgian_holidays(p_year);
  perform public.log_audit('holidays.seed', null, 'Georgian public holidays added for ' || p_year || ' (' || added || ' new)',
    jsonb_build_object('year', p_year, 'added', added));
  return added;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Allowances and requests
-- ---------------------------------------------------------------------
create table if not exists public.leave_allowances (
  employee_id uuid not null references public.employees(id) on delete cascade,
  year        int  not null check (year between 2000 and 2100),
  category    text not null check (category in ('vacation', 'unpaid', 'day_off')),
  days        int  not null check (days between 0 and 366),
  primary key (employee_id, year, category)
);

create table if not exists public.leave_requests (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references public.employees(id) on delete cascade,
  category              text not null check (category in ('vacation', 'unpaid', 'day_off')),
  start_date            date not null check (start_date >= date '2000-01-01'),
  end_date              date not null,
  comment               text check (comment is null or length(comment) <= 500),
  requested_approver_id uuid references public.employees(id) on delete set null,
  replacement_id        uuid references public.employees(id) on delete set null,
  status                text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by            uuid references public.employees(id) on delete set null,
  decided_at            timestamptz,
  decision_comment      text check (decision_comment is null or length(decision_comment) <= 500),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint leave_requests_dates_chk check (end_date >= start_date and end_date - start_date < 366)
);
create index if not exists leave_requests_employee_idx on public.leave_requests (employee_id, start_date);
create index if not exists leave_requests_period_idx   on public.leave_requests (start_date, end_date);
create index if not exists leave_requests_status_idx   on public.leave_requests (status);

drop trigger if exists leave_requests_updated_at_trg on public.leave_requests;
create trigger leave_requests_updated_at_trg before update on public.leave_requests
  for each row execute function public.set_updated_at();
drop trigger if exists employee_profiles_updated_at_trg on public.employee_profiles;
create trigger employee_profiles_updated_at_trg before update on public.employee_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 5. Row Level Security (all writes go through the functions below)
-- ---------------------------------------------------------------------
alter table public.employee_profiles enable row level security;
alter table public.public_holidays   enable row level security;
alter table public.leave_allowances  enable row level security;
alter table public.leave_requests    enable row level security;

drop policy if exists employee_profiles_select on public.employee_profiles;
create policy employee_profiles_select on public.employee_profiles
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.is_ceo());

drop policy if exists public_holidays_select on public.public_holidays;
drop policy if exists public_holidays_ceo_insert on public.public_holidays;
drop policy if exists public_holidays_ceo_update on public.public_holidays;
drop policy if exists public_holidays_ceo_delete on public.public_holidays;
create policy public_holidays_select on public.public_holidays
  for select to authenticated using (true);
create policy public_holidays_ceo_insert on public.public_holidays
  for insert to authenticated with check (public.is_ceo());
create policy public_holidays_ceo_update on public.public_holidays
  for update to authenticated using (public.is_ceo()) with check (public.is_ceo());
create policy public_holidays_ceo_delete on public.public_holidays
  for delete to authenticated using (public.is_ceo());

drop policy if exists leave_allowances_select on public.leave_allowances;
create policy leave_allowances_select on public.leave_allowances
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.is_ceo());

drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_ceo()
    or public.in_my_headed_department(employee_id)
  );

revoke all on public.employee_profiles, public.public_holidays, public.leave_allowances, public.leave_requests from anon;
revoke insert, update, delete, truncate on public.employee_profiles, public.leave_allowances, public.leave_requests from authenticated;
revoke truncate on public.public_holidays from authenticated;
grant select on public.employee_profiles, public.leave_allowances, public.leave_requests to authenticated;
grant select, insert, update, delete on public.public_holidays to authenticated;

-- ---------------------------------------------------------------------
-- 6. Day counting and balances
-- ---------------------------------------------------------------------
create or replace function public.leave_working_days(p_start date, p_end date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') g(d)
  where extract(isodow from g.d) < 6
    and not exists (select 1 from public.public_holidays h where h.holiday_date = g.d::date);
$$;

create or replace function public.leave_days_in_year(p_start date, p_end date, p_year int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when greatest(p_start, make_date(p_year, 1, 1)) > least(p_end, make_date(p_year, 12, 31)) then 0
    else public.leave_working_days(greatest(p_start, make_date(p_year, 1, 1)), least(p_end, make_date(p_year, 12, 31)))
  end;
$$;

create or replace function public.leave_allowance_for(p_employee_id uuid, p_year int, p_category text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select a.days from public.leave_allowances a
      where a.employee_id = p_employee_id and a.year = p_year and a.category = p_category),
    (select case p_category
              when 'vacation' then s.leave_vacation_days
              when 'unpaid'   then s.leave_unpaid_days
              else s.leave_day_off_days
            end
       from public.company_settings s where s.id = 1)
  );
$$;

create or replace function public.leave_used_days(
  p_employee_id uuid, p_year int, p_category text, p_status text, p_exclude uuid default null
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(public.leave_days_in_year(r.start_date, r.end_date, p_year)), 0)::int
  from public.leave_requests r
  where r.employee_id = p_employee_id
    and r.category = p_category
    and r.status = p_status
    and r.id is distinct from p_exclude;
$$;

create or replace function public.leave_category_label(p_category text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_category when 'vacation' then 'vacation' when 'unpaid' then 'unpaid leave' else 'day off' end;
$$;

-- Who may look at a person's leave data: the person, any CEO / developer, their department head.
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
     and not public.is_ceo()
     and not public.in_my_headed_department(p_employee_id) then
    raise exception 'You cannot see this person''s leaves.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.leave_balance(p_employee_id uuid, p_year int)
returns table (category text, allowance int, used int, pending int, remaining int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_can_view_leaves(p_employee_id);
  return query
    select c.category,
           public.leave_allowance_for(p_employee_id, p_year, c.category),
           public.leave_used_days(p_employee_id, p_year, c.category, 'approved'),
           public.leave_used_days(p_employee_id, p_year, c.category, 'pending'),
           public.leave_allowance_for(p_employee_id, p_year, c.category)
             - public.leave_used_days(p_employee_id, p_year, c.category, 'approved')
             - public.leave_used_days(p_employee_id, p_year, c.category, 'pending')
    from (values ('vacation', 1), ('unpaid', 2), ('day_off', 3)) as c(category, ord)
    order by c.ord;
end;
$$;

-- Everyone's balances for the analytics tab. CEO / developer: all active accounts;
-- a department head: their own department.
create or replace function public.leave_balances_all(p_year int)
returns table (employee_id uuid, category text, allowance int, used int, pending int, remaining int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_ceo() and public.head_department_id() is null then
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
      and (public.is_ceo() or (e.department_id is not null and e.department_id = public.head_department_id()))
    order by e.employee_number, c.ord;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Request form helpers
-- ---------------------------------------------------------------------
-- Who can I ask for approval, and who can replace me? (A plain employee cannot read
-- other employees' rows, so the form gets its choices from here.)
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

  return jsonb_build_object(
    'approvers', approvers,
    'replacements', replacements,
    'replacement_required', jsonb_array_length(replacements) > 0
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Requesting, deciding, cancelling
-- ---------------------------------------------------------------------
create or replace function public.assert_leave_dates(p_start date, p_end date)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days int;
begin
  if p_start is null or p_end is null then
    raise exception 'Choose a start and an end date.' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'The end date cannot be before the start date.' using errcode = '22023';
  end if;
  if p_start < date '2000-01-01' or p_end - p_start >= 366 then
    raise exception 'A leave can be at most one year long.' using errcode = '22023';
  end if;
  days := public.leave_working_days(p_start, p_end);
  if days = 0 then
    raise exception 'That period has no working days (weekends and public holidays are not counted).' using errcode = '22023';
  end if;
  return days;
end;
$$;

create or replace function public.assert_no_leave_overlap(p_employee_id uuid, p_start date, p_end date, p_exclude uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.leave_requests r
     where r.employee_id = p_employee_id
       and r.status in ('pending', 'approved')
       and r.id is distinct from p_exclude
       and r.start_date <= p_end and r.end_date >= p_start
  ) then
    raise exception 'You already have a pending or approved leave that overlaps these dates.' using errcode = '22023';
  end if;
end;
$$;

-- Is there room in every year the leave touches? Pending requests count as taken.
create or replace function public.assert_leave_balance(
  p_employee_id uuid, p_category text, p_start date, p_end date, p_exclude uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  y int;
  need int;
  allowance int;
  taken int;
begin
  for y in extract(year from p_start)::int .. extract(year from p_end)::int loop
    need := public.leave_days_in_year(p_start, p_end, y);
    continue when need = 0;
    allowance := public.leave_allowance_for(p_employee_id, y, p_category);
    taken := public.leave_used_days(p_employee_id, y, p_category, 'approved', p_exclude)
           + public.leave_used_days(p_employee_id, y, p_category, 'pending', p_exclude);
    if need > allowance - taken then
      raise exception 'Not enough days left for % in %: % left, % requested.',
        public.leave_category_label(p_category), y, greatest(allowance - taken, 0), need
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

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
  ) then
    raise exception 'Leave must be approved by your department head or a CEO.' using errcode = '22023';
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
  if not (public.is_ceo() or public.in_my_headed_department(r.employee_id)) then
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

-- Who may change a developer's leave? Only a developer.
create or replace function public.assert_can_change_leave_of(p_employee_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_employee_id is not null
     and not public.is_developer()
     and exists (select 1 from public.employees e where e.id = p_employee_id and e.role = 'developer') then
    raise exception 'Only a developer can change a developer''s leave.' using errcode = '42501';
  end if;
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

  if not (mine or public.is_ceo() or public.in_my_headed_department(r.employee_id)) then
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
-- 9. Listing (names resolved here, because a plain employee cannot read other rows)
-- ---------------------------------------------------------------------
-- p_scope 'mine'    : my own requests (p_status null = any status)
--         'managed' : everyone's (CEO / developer) or my department's (head)
create or replace function public.list_leaves(p_scope text, p_from date default null, p_to date default null, p_status text default null)
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
       and (
         (p_scope = 'mine' and r.employee_id = me)
         or (p_scope = 'managed' and (
               public.is_ceo()
               or (e.department_id is not null and e.department_id = public.head_department_id())))
       )
     order by r.start_date desc, r.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Profile dates and allowances (CEO / developer; a developer for CEO / developer accounts)
-- ---------------------------------------------------------------------
create or replace function public.assert_can_edit_profile_of(p_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_role text;
begin
  if not public.is_ceo() then
    raise exception 'Only a CEO or developer can change this.' using errcode = '42501';
  end if;
  select role into target_role from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if target_role in ('ceo', 'developer')
     and not public.is_developer()
     and p_employee_id is distinct from public.current_employee_id() then
    raise exception 'Only a developer can change a CEO''s or developer''s details.' using errcode = '42501';
  end if;
  return target_role;
end;
$$;

create or replace function public.set_employee_dates(p_employee_id uuid, p_birth_date date, p_hire_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.employee_profiles;
begin
  perform public.assert_can_edit_profile_of(p_employee_id);
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > public.company_today()) then
    raise exception 'Birth date must be a real date in the past.' using errcode = '22023';
  end if;
  if p_hire_date is not null and (p_hire_date < date '1950-01-01' or p_hire_date > public.company_today() + 366) then
    raise exception 'Hire date is not a valid date.' using errcode = '22023';
  end if;

  select * into before_row from public.employee_profiles where employee_id = p_employee_id;
  insert into public.employee_profiles (employee_id, birth_date, hire_date)
  values (p_employee_id, p_birth_date, p_hire_date)
  on conflict (employee_id) do update set birth_date = excluded.birth_date, hire_date = excluded.hire_date;

  perform public.log_audit('employee.dates', p_employee_id, 'Birth date / hire date updated',
    jsonb_build_object('old_birth', before_row.birth_date, 'old_hire', before_row.hire_date,
                       'new_birth', p_birth_date, 'new_hire', p_hire_date));
end;
$$;

-- p_days = null removes the override (the company default applies again).
create or replace function public.set_leave_allowance(p_employee_id uuid, p_year int, p_category text, p_days int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_days int;
begin
  perform public.assert_can_edit_profile_of(p_employee_id);
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'Choose a valid year.' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('vacation', 'unpaid', 'day_off') then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_days is not null and (p_days < 0 or p_days > 366) then
    raise exception 'Days must be between 0 and 366.' using errcode = '22023';
  end if;

  select days into old_days from public.leave_allowances
   where employee_id = p_employee_id and year = p_year and category = p_category;
  if p_days is null then
    delete from public.leave_allowances where employee_id = p_employee_id and year = p_year and category = p_category;
  else
    insert into public.leave_allowances (employee_id, year, category, days)
    values (p_employee_id, p_year, p_category, p_days)
    on conflict (employee_id, year, category) do update set days = excluded.days;
  end if;

  perform public.log_audit('leave.allowance', p_employee_id,
    public.leave_category_label(p_category) || ' allowance for ' || p_year || ': '
      || coalesce(old_days::text, 'default') || ' -> ' || coalesce(p_days::text, 'default'),
    jsonb_build_object('year', p_year, 'category', p_category, 'old', old_days, 'new', p_days));
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Developer: edit or create any leave, delete any leave
-- ---------------------------------------------------------------------
create or replace function public.dev_save_leave(
  p_leave_id         uuid,
  p_employee_id      uuid,
  p_category         text,
  p_start            date,
  p_end              date,
  p_comment          text,
  p_approver_id      uuid,
  p_replacement_id   uuid,
  p_status           text,
  p_decision_comment text
)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_employee_id();
  before_row public.leave_requests;
  rec public.leave_requests;
begin
  if not public.is_developer() then
    raise exception 'Only a developer can do this.' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('vacation', 'unpaid', 'day_off') then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('pending', 'approved', 'rejected', 'cancelled') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_approver_id is not null and not exists (select 1 from public.employees where id = p_approver_id) then
    raise exception 'Approver not found.' using errcode = 'P0002';
  end if;
  if p_replacement_id is not null and (p_replacement_id = p_employee_id
       or not exists (select 1 from public.employees where id = p_replacement_id)) then
    raise exception 'Replacement must be another existing employee.' using errcode = '22023';
  end if;
  perform public.assert_leave_dates(p_start, p_end);
  if p_status in ('pending', 'approved') then
    perform public.assert_no_leave_overlap(p_employee_id, p_start, p_end, p_leave_id);
  end if;

  if p_leave_id is null then
    insert into public.leave_requests (employee_id, category, start_date, end_date, comment, requested_approver_id,
                                       replacement_id, status, decided_by, decided_at, decision_comment)
    values (p_employee_id, p_category, p_start, p_end, nullif(trim(coalesce(p_comment, '')), ''), p_approver_id,
            p_replacement_id, p_status,
            case when p_status in ('approved', 'rejected') then me end,
            case when p_status in ('approved', 'rejected') then now() end,
            nullif(trim(coalesce(p_decision_comment, '')), ''))
    returning * into rec;
    perform public.log_audit('leave.dev_create', rec.employee_id,
      'Developer created ' || public.leave_category_label(p_category) || ' ' || p_start || ' to ' || p_end || ' (' || p_status || ')',
      jsonb_build_object('leave_id', rec.id, 'new', to_jsonb(rec)));
  else
    select * into before_row from public.leave_requests where id = p_leave_id for update;
    if not found then
      raise exception 'Leave request not found.' using errcode = 'P0002';
    end if;
    update public.leave_requests
       set employee_id = p_employee_id,
           category = p_category,
           start_date = p_start,
           end_date = p_end,
           comment = nullif(trim(coalesce(p_comment, '')), ''),
           requested_approver_id = p_approver_id,
           replacement_id = p_replacement_id,
           status = p_status,
           decided_by = case when p_status in ('approved', 'rejected') and p_status is distinct from before_row.status then me
                             when p_status in ('pending') then null
                             else before_row.decided_by end,
           decided_at = case when p_status in ('approved', 'rejected') and p_status is distinct from before_row.status then now()
                             when p_status in ('pending') then null
                             else before_row.decided_at end,
           decision_comment = nullif(trim(coalesce(p_decision_comment, '')), '')
     where id = p_leave_id
     returning * into rec;
    perform public.log_audit('leave.dev_update', rec.employee_id,
      'Developer edited ' || public.leave_category_label(p_category) || ' ' || p_start || ' to ' || p_end || ' (' || p_status || ')',
      jsonb_build_object('leave_id', rec.id, 'old', to_jsonb(before_row), 'new', to_jsonb(rec)));
  end if;
  return rec;
end;
$$;

create or replace function public.dev_delete_leave(p_leave_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leave_requests;
begin
  if not public.is_developer() then
    raise exception 'Only a developer can do this.' using errcode = '42501';
  end if;
  delete from public.leave_requests where id = p_leave_id returning * into r;
  if not found then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  perform public.log_audit('leave.delete', r.employee_id,
    'Developer deleted ' || public.leave_category_label(r.category) || ' ' || r.start_date || ' to ' || r.end_date,
    jsonb_build_object('leave_id', r.id, 'old', to_jsonb(r)));
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Function privileges
-- ---------------------------------------------------------------------
revoke all on function public.company_today()                                          from public, anon;
revoke all on function public.orthodox_easter(int)                                     from public, anon;
revoke all on function public.seed_georgian_holidays(int)                              from public, anon, authenticated;
revoke all on function public.add_georgian_holidays(int)                               from public, anon;
revoke all on function public.leave_working_days(date, date)                           from public, anon;
revoke all on function public.leave_days_in_year(date, date, int)                      from public, anon, authenticated;
revoke all on function public.leave_allowance_for(uuid, int, text)                     from public, anon, authenticated;
revoke all on function public.leave_used_days(uuid, int, text, text, uuid)             from public, anon, authenticated;
revoke all on function public.leave_category_label(text)                               from public, anon, authenticated;
revoke all on function public.assert_can_view_leaves(uuid)                             from public, anon, authenticated;
revoke all on function public.assert_leave_dates(date, date)                           from public, anon, authenticated;
revoke all on function public.assert_no_leave_overlap(uuid, date, date, uuid)          from public, anon, authenticated;
revoke all on function public.assert_leave_balance(uuid, text, date, date, uuid)       from public, anon, authenticated;
revoke all on function public.assert_can_change_leave_of(uuid)                         from public, anon, authenticated;
revoke all on function public.assert_can_edit_profile_of(uuid)                         from public, anon, authenticated;
revoke all on function public.leave_balance(uuid, int)                                 from public, anon;
revoke all on function public.leave_balances_all(int)                                  from public, anon;
revoke all on function public.leave_form_options()                                     from public, anon;
revoke all on function public.request_leave(text, date, date, text, uuid, uuid)        from public, anon;
revoke all on function public.decide_leave(uuid, text, text)                           from public, anon;
revoke all on function public.cancel_leave(uuid, text)                                 from public, anon;
revoke all on function public.list_leaves(text, date, date, text)                    from public, anon;
revoke all on function public.set_employee_dates(uuid, date, date)                     from public, anon;
revoke all on function public.set_leave_allowance(uuid, int, text, int)                from public, anon;
revoke all on function public.dev_save_leave(uuid, uuid, text, date, date, text, uuid, uuid, text, text) from public, anon;
revoke all on function public.dev_delete_leave(uuid)                                   from public, anon;

grant execute on function public.company_today()                                       to authenticated;
grant execute on function public.add_georgian_holidays(int)                            to authenticated;
grant execute on function public.leave_working_days(date, date)                        to authenticated;
grant execute on function public.leave_balance(uuid, int)                              to authenticated;
grant execute on function public.leave_balances_all(int)                               to authenticated;
grant execute on function public.leave_form_options()                                  to authenticated;
grant execute on function public.request_leave(text, date, date, text, uuid, uuid)     to authenticated;
grant execute on function public.decide_leave(uuid, text, text)                        to authenticated;
grant execute on function public.cancel_leave(uuid, text)                              to authenticated;
grant execute on function public.list_leaves(text, date, date, text)                 to authenticated;
grant execute on function public.set_employee_dates(uuid, date, date)                  to authenticated;
grant execute on function public.set_leave_allowance(uuid, int, text, int)             to authenticated;
grant execute on function public.dev_save_leave(uuid, uuid, text, date, date, text, uuid, uuid, text, text) to authenticated;
grant execute on function public.dev_delete_leave(uuid)                                to authenticated;

commit;
