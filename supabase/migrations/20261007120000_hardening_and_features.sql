-- =====================================================================
-- Looper Agency: security hardening + server-side attendance + CEO tools
--
-- WHAT THIS DOES
--   1. Replaces ALL existing RLS policies on the five app tables with a
--      small, explicit set (clients can only READ; writes go through
--      SECURITY DEFINER functions or the Edge Functions).
--   2. Moves clock-in / clock-out to the server (now(), company time zone,
--      worked_minutes and request IP are computed in the database).
--   3. Adds CEO RPCs for attendance corrections, each written to audit_logs.
--   4. Adds automatic clock-out (pg_cron) at company_settings.work_end_time.
--   5. Fixes foreign keys so deleting an employee / auth user cannot leave a
--      half-deleted state, and snapshots the employee name on each
--      attendance row so history stays readable after a deletion.
--
-- IMPORTANT: step 1 DROPS every existing policy on these tables. Run
--   select schemaname, tablename, policyname, cmd from pg_policies
--   where schemaname = 'public';
-- first if you want to review what is currently there.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Settings row must exist
-- ---------------------------------------------------------------------
insert into public.company_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 1. Helper functions
-- ---------------------------------------------------------------------
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
      and e.role = 'ceo'
      and e.is_active
  );
$$;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.auth_user_id = auth.uid()
    and e.is_active
  limit 1;
$$;

-- Client IP as seen by the Supabase gateway. Informational only: it is
-- recorded, never used to allow or deny anything.
create or replace function public.request_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  headers_text text := current_setting('request.headers', true);
  h json;
  candidate text;
begin
  if headers_text is null or headers_text = '' then
    return null;
  end if;
  h := headers_text::json;
  candidate := coalesce(
    nullif(h ->> 'cf-connecting-ip', ''),
    nullif(h ->> 'x-real-ip', ''),
    nullif(trim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), '')
  );
  if candidate is null then
    return null;
  end if;
  return candidate::inet;
exception when others then
  return null;
end;
$$;

-- Internal audit writer. Not exposed to API roles.
create or replace function public.log_audit(
  p_action text,
  p_employee_id uuid,
  p_description text,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (actor_user_id, employee_id, action, description, ip_address, metadata)
  values (auth.uid(), p_employee_id, p_action, p_description, public.request_ip(), p_metadata);
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Schema fixes
-- ---------------------------------------------------------------------

-- Snapshot columns so attendance stays attributable after a hard delete.
alter table public.attendance add column if not exists employee_number text;
alter table public.attendance add column if not exists employee_name text;

update public.attendance a
set employee_number = e.employee_number,
    employee_name   = e.first_name || ' ' || e.last_name
from public.employees e
where e.id = a.employee_id
  and (a.employee_number is null or a.employee_name is null);

-- One record per employee per day (code already relies on this).
create unique index if not exists attendance_employee_work_date_uidx
  on public.attendance (employee_id, work_date);
create index if not exists attendance_work_date_idx
  on public.attendance (work_date);
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

-- Clock-out can never precede clock-in (NOT VALID: applies to new writes only).
alter table public.attendance drop constraint if exists attendance_clock_order_chk;
alter table public.attendance
  add constraint attendance_clock_order_chk
  check (clock_out is null or clock_out >= clock_in) not valid;

-- Deleting an employee keeps the history and the audit trail.
alter table public.attendance drop constraint if exists attendance_employee_id_fkey;
alter table public.attendance
  add constraint attendance_employee_id_fkey
  foreign key (employee_id) references public.employees(id) on delete set null;

alter table public.audit_logs drop constraint if exists audit_logs_employee_id_fkey;
alter table public.audit_logs
  add constraint audit_logs_employee_id_fkey
  foreign key (employee_id) references public.employees(id) on delete set null;

alter table public.audit_logs drop constraint if exists audit_logs_actor_user_id_fkey;
alter table public.audit_logs
  add constraint audit_logs_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete set null;

-- Deleting the login first (safe delete order) must not be blocked by the employee row.
alter table public.employees drop constraint if exists employees_auth_user_id_fkey;
alter table public.employees
  add constraint employees_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete set null;

-- Snapshot trigger
create or replace function public.attendance_fill_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.employee_id is not null
     and (new.employee_number is null or new.employee_name is null) then
    select e.employee_number, e.first_name || ' ' || e.last_name
      into new.employee_number, new.employee_name
    from public.employees e
    where e.id = new.employee_id;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_snapshot_trg on public.attendance;
create trigger attendance_snapshot_trg
  before insert on public.attendance
  for each row execute function public.attendance_fill_snapshot();

-- Keep the snapshot fresh when someone is renamed.
create or replace function public.employees_sync_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.employee_number is distinct from old.employee_number then
    update public.attendance
       set employee_number = new.employee_number,
           employee_name   = new.first_name || ' ' || new.last_name
     where employee_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_snapshot_trg on public.employees;
create trigger employees_snapshot_trg
  after update on public.employees
  for each row execute function public.employees_sync_snapshot();

-- updated_at maintenance
drop trigger if exists employees_updated_at_trg on public.employees;
create trigger employees_updated_at_trg before update on public.employees
  for each row execute function public.set_updated_at();
drop trigger if exists attendance_updated_at_trg on public.attendance;
create trigger attendance_updated_at_trg before update on public.attendance
  for each row execute function public.set_updated_at();
drop trigger if exists departments_updated_at_trg on public.departments;
create trigger departments_updated_at_trg before update on public.departments
  for each row execute function public.set_updated_at();
drop trigger if exists company_settings_updated_at_trg on public.company_settings;
create trigger company_settings_updated_at_trg before update on public.company_settings
  for each row execute function public.set_updated_at();

-- company_settings validation (time zone must exist)
create or replace function public.company_settings_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  if new.work_start_time = new.work_end_time then
    raise exception 'Work start and end time cannot be the same.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists company_settings_validate_trg on public.company_settings;
create trigger company_settings_validate_trg
  before insert or update on public.company_settings
  for each row execute function public.company_settings_validate();

-- Audit changes to settings and departments (who changed what).
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_audit(tg_table_name || '.delete', null, tg_table_name || ' deleted',
      jsonb_build_object('old', to_jsonb(old)));
    return old;
  elsif tg_op = 'INSERT' then
    perform public.log_audit(tg_table_name || '.insert', null, tg_table_name || ' created',
      jsonb_build_object('new', to_jsonb(new)));
    return new;
  else
    perform public.log_audit(tg_table_name || '.update', null, tg_table_name || ' updated',
      jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)));
    return new;
  end if;
end;
$$;

drop trigger if exists company_settings_audit_trg on public.company_settings;
create trigger company_settings_audit_trg
  after update on public.company_settings
  for each row execute function public.audit_row_change();

drop trigger if exists departments_audit_trg on public.departments;
create trigger departments_audit_trg
  after insert or update or delete on public.departments
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- 3. Row Level Security: reset and rebuild
-- ---------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('employees','attendance','departments','audit_logs','company_settings')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.employees        enable row level security;
alter table public.attendance       enable row level security;
alter table public.departments      enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.company_settings enable row level security;

-- employees: read own row, CEO reads all. No client writes (Edge Functions + RPCs only).
create policy employees_select on public.employees
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_ceo());

-- attendance: read own, CEO reads all. No client writes.
create policy attendance_select on public.attendance
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.is_ceo());

-- departments: everyone signed in can read; CEO manages.
create policy departments_select on public.departments
  for select to authenticated using (true);
create policy departments_ceo_insert on public.departments
  for insert to authenticated with check (public.is_ceo());
create policy departments_ceo_update on public.departments
  for update to authenticated using (public.is_ceo()) with check (public.is_ceo());
create policy departments_ceo_delete on public.departments
  for delete to authenticated using (public.is_ceo());

-- audit_logs: CEO read-only. Rows are written by SECURITY DEFINER code only.
create policy audit_logs_ceo_select on public.audit_logs
  for select to authenticated using (public.is_ceo());

-- company_settings: CEO only (employees use get_app_settings()).
create policy company_settings_ceo_select on public.company_settings
  for select to authenticated using (public.is_ceo());
create policy company_settings_ceo_update on public.company_settings
  for update to authenticated using (public.is_ceo()) with check (public.is_ceo());

-- Defence in depth: table privileges match the policies.
revoke all on public.employees, public.attendance, public.departments,
              public.audit_logs, public.company_settings from anon;
revoke insert, update, delete, truncate on public.employees  from authenticated;
revoke insert, update, delete, truncate on public.attendance from authenticated;
revoke insert, update, delete, truncate on public.audit_logs from authenticated;
revoke insert, delete, truncate on public.company_settings   from authenticated;
revoke truncate on public.departments from authenticated;

-- ---------------------------------------------------------------------
-- 4. Employee-facing RPCs (server time, server calculations)
-- ---------------------------------------------------------------------
create or replace function public.get_app_settings()
returns table (company_name text, work_start_time time, work_end_time time, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.company_name, s.work_start_time, s.work_end_time, s.timezone
  from public.company_settings s
  where s.id = 1
    and auth.uid() is not null;
$$;

create or replace function public.clock_in()
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp public.employees;
  tz text;
  rec public.attendance;
begin
  select * into emp
  from public.employees
  where auth_user_id = auth.uid() and is_active;

  if not found then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;

  select s.timezone into tz from public.company_settings s where s.id = 1;

  insert into public.attendance (employee_id, work_date, clock_in, clock_in_ip)
  values (emp.id, (now() at time zone coalesce(tz, 'UTC'))::date, now(), public.request_ip())
  returning * into rec;

  return rec;
exception
  when unique_violation then
    raise exception 'You have already clocked in today.' using errcode = '23505';
end;
$$;

create or replace function public.clock_out()
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp_id uuid;
  rec public.attendance;
  ts timestamptz := now();
begin
  emp_id := public.current_employee_id();
  if emp_id is null then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;

  select * into rec
  from public.attendance
  where employee_id = emp_id and clock_out is null
  order by clock_in desc
  limit 1
  for update;

  if not found then
    raise exception 'You are not clocked in.' using errcode = 'P0001';
  end if;

  update public.attendance
     set clock_out      = ts,
         clockout_type  = 'manual',
         clock_out_ip   = public.request_ip(),
         worked_minutes = greatest(0, floor(extract(epoch from (ts - clock_in)) / 60))::int
   where id = rec.id
   returning * into rec;

  return rec;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. CEO RPCs (corrections are always audited and need a reason)
-- ---------------------------------------------------------------------
create or replace function public.ceo_save_attendance(
  p_attendance_id uuid,
  p_employee_id   uuid,
  p_clock_in      timestamptz,
  p_clock_out     timestamptz,
  p_reason        text
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text;
  before_row public.attendance;
  rec public.attendance;
  minutes int;
  wd date;
begin
  if not public.is_ceo() then
    raise exception 'Only the CEO can edit attendance.' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason of at least 3 characters is required.' using errcode = '22023';
  end if;
  if p_clock_in is null then
    raise exception 'Clock-in time is required.' using errcode = '22023';
  end if;
  if p_clock_out is not null and p_clock_out < p_clock_in then
    raise exception 'Clock-out cannot be before clock-in.' using errcode = '22023';
  end if;

  select s.timezone into tz from public.company_settings s where s.id = 1;
  wd := (p_clock_in at time zone coalesce(tz, 'UTC'))::date;
  minutes := case when p_clock_out is null then null
                  else floor(extract(epoch from (p_clock_out - p_clock_in)) / 60)::int end;

  if p_attendance_id is null then
    if p_employee_id is null or not exists (select 1 from public.employees where id = p_employee_id) then
      raise exception 'Employee not found.' using errcode = 'P0002';
    end if;

    insert into public.attendance (employee_id, work_date, clock_in, clock_out, clockout_type, worked_minutes)
    values (p_employee_id, wd, p_clock_in, p_clock_out,
            case when p_clock_out is null then null else 'manual' end, minutes)
    returning * into rec;

    perform public.log_audit('attendance.create', rec.employee_id,
      'CEO created attendance record: ' || trim(p_reason),
      jsonb_build_object('attendance_id', rec.id, 'reason', trim(p_reason), 'new', to_jsonb(rec)));
  else
    select * into before_row from public.attendance where id = p_attendance_id for update;
    if not found then
      raise exception 'Attendance record not found.' using errcode = 'P0002';
    end if;

    update public.attendance
       set work_date      = wd,
           clock_in       = p_clock_in,
           clock_out      = p_clock_out,
           clockout_type  = case when p_clock_out is null then null else 'manual' end,
           worked_minutes = minutes
     where id = p_attendance_id
     returning * into rec;

    perform public.log_audit('attendance.update', rec.employee_id,
      'CEO corrected attendance record: ' || trim(p_reason),
      jsonb_build_object('attendance_id', rec.id, 'reason', trim(p_reason),
                         'old', to_jsonb(before_row), 'new', to_jsonb(rec)));
  end if;

  return rec;
exception
  when unique_violation then
    raise exception 'This employee already has a record for that date.' using errcode = '23505';
end;
$$;

create or replace function public.ceo_delete_attendance(p_attendance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.attendance;
begin
  if not public.is_ceo() then
    raise exception 'Only the CEO can delete attendance.' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason of at least 3 characters is required.' using errcode = '22023';
  end if;

  delete from public.attendance where id = p_attendance_id returning * into before_row;
  if not found then
    raise exception 'Attendance record not found.' using errcode = 'P0002';
  end if;

  perform public.log_audit('attendance.delete', before_row.employee_id,
    'CEO deleted attendance record: ' || trim(p_reason),
    jsonb_build_object('attendance_id', before_row.id, 'reason', trim(p_reason), 'old', to_jsonb(before_row)));
end;
$$;

create or replace function public.ceo_set_employee_department(p_employee_id uuid, p_department_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_dept uuid;
begin
  if not public.is_ceo() then
    raise exception 'Only the CEO can change departments.' using errcode = '42501';
  end if;

  select department_id into old_dept from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;

  update public.employees set department_id = p_department_id where id = p_employee_id;

  perform public.log_audit('employee.department', p_employee_id, 'Department changed',
    jsonb_build_object('old_department_id', old_dept, 'new_department_id', p_department_id));
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Automatic clock-out
-- ---------------------------------------------------------------------
-- An older version may exist with a different return type, which CREATE OR REPLACE cannot change.
drop function if exists public.auto_clock_out();

create or replace function public.auto_clock_out()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.company_settings;
  r public.attendance;
  end_date date;
  end_ts timestamptz;
  closed integer := 0;
begin
  select * into s from public.company_settings where id = 1;
  if not found then
    return 0;
  end if;

  for r in
    select * from public.attendance
    where clock_out is null
    for update skip locked
  loop
    -- Shifts that cross midnight (end <= start) finish on the next day.
    end_date := r.work_date + case when s.work_end_time <= s.work_start_time then 1 else 0 end;
    end_ts := (end_date + s.work_end_time) at time zone s.timezone;

    if now() >= end_ts then
      end_ts := greatest(end_ts, r.clock_in);

      update public.attendance
         set clock_out      = end_ts,
             clockout_type  = 'automatic',
             worked_minutes = floor(extract(epoch from (end_ts - r.clock_in)) / 60)::int
       where id = r.id;

      insert into public.audit_logs (actor_user_id, employee_id, action, description, metadata)
      values (null, r.employee_id, 'attendance.auto_clock_out',
              'Automatically clocked out at end of work day',
              jsonb_build_object('attendance_id', r.id, 'clock_out', end_ts));

      closed := closed + 1;
    end if;
  end loop;

  return closed;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Function privileges
-- ---------------------------------------------------------------------
revoke all on function public.is_ceo()                                   from public, anon;
revoke all on function public.current_employee_id()                      from public, anon;
revoke all on function public.request_ip()                               from public, anon;
revoke all on function public.log_audit(text, uuid, text, jsonb)         from public, anon, authenticated;
revoke all on function public.get_app_settings()                         from public, anon;
revoke all on function public.clock_in()                                 from public, anon;
revoke all on function public.clock_out()                                from public, anon;
revoke all on function public.ceo_save_attendance(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.ceo_delete_attendance(uuid, text)          from public, anon;
revoke all on function public.ceo_set_employee_department(uuid, uuid)    from public, anon;
revoke all on function public.auto_clock_out()                           from public, anon, authenticated;

grant execute on function public.is_ceo()                                   to authenticated;
grant execute on function public.current_employee_id()                      to authenticated;
grant execute on function public.request_ip()                               to authenticated;
grant execute on function public.get_app_settings()                         to authenticated;
grant execute on function public.clock_in()                                 to authenticated;
grant execute on function public.clock_out()                                to authenticated;
grant execute on function public.ceo_save_attendance(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.ceo_delete_attendance(uuid, text)          to authenticated;
grant execute on function public.ceo_set_employee_department(uuid, uuid)    to authenticated;

commit;

-- ---------------------------------------------------------------------
-- 8. Schedule auto clock-out every 10 minutes (needs pg_cron).
--    Outside the transaction so a missing extension cannot roll back the rest.
--    If this prints a NOTICE, enable pg_cron in Dashboard > Database >
--    Extensions and run:
--      select cron.schedule('auto-clock-out', '*/10 * * * *', 'select public.auto_clock_out()');
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('auto-clock-out');
  exception when others then
    null; -- not scheduled yet
  end;
  perform cron.schedule('auto-clock-out', '*/10 * * * *', 'select public.auto_clock_out()');
exception when others then
  raise notice 'pg_cron is not available (%). Schedule public.auto_clock_out() manually.', sqlerrm;
end $$;
