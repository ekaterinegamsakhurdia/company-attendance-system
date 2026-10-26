-- =====================================================================
-- Looper Agency, migration 9: online work days and overtime
--
-- ONLINE WORK DAY
--   * attendance.work_mode: 'office' (default) or 'online'.
--   * clock_in(p_verification, p_online): an employee who works from home today
--     switches to online mode and clocks in from any network. Face ID /
--     fingerprint is still required when that switch is on. The clock-out of an
--     online day is also allowed from any network.
--   * company_settings.allow_online_days (default on): a CEO / developer can
--     switch the whole feature off.
--
-- OVERTIME
--   * start_overtime(): after the company's end time, on the company network, a
--     person who worked at the company presses "Log overtime". That cancels the
--     automatic clock-out at the end time (also re-opens a day that the
--     automatic clock-out has already closed).
--   * clock_out(): ends the overtime. The clock-out time becomes the real one and
--     attendance.overtime_minutes = real clock-out minus the company end time.
--     This is written to the audit log (action attendance.overtime).
--   * If the person never clocks out, the automatic clock-out closes the day at
--     midnight at the company end time and no overtime is counted (a CEO can
--     correct the record in Reports; the minutes are recalculated).
--
-- Safe to run more than once, on a database that has migrations 1-8.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.attendance
  add column if not exists work_mode text not null default 'office',
  add column if not exists overtime_started_at timestamptz,
  add column if not exists overtime_minutes integer not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_work_mode_check') then
    alter table public.attendance add constraint attendance_work_mode_check check (work_mode in ('office', 'online'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_overtime_minutes_check') then
    alter table public.attendance add constraint attendance_overtime_minutes_check check (overtime_minutes >= 0);
  end if;
end $$;

alter table public.company_settings
  add column if not exists allow_online_days boolean not null default true;

-- overtime_minutes is always derived: (clock-out - company end time), only for a day with logged overtime.
-- A trigger keeps it right for clock-out, the automatic clock-out and CEO corrections alike.
create or replace function public.attendance_overtime_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.company_settings;
  end_ts timestamptz;
begin
  if new.overtime_started_at is null or new.clock_out is null then
    new.overtime_minutes := 0;
    return new;
  end if;
  select * into s from public.company_settings where id = 1;
  if not found then
    new.overtime_minutes := 0;
    return new;
  end if;
  end_ts := ((new.work_date + case when s.work_end_time <= s.work_start_time then 1 else 0 end) + s.work_end_time)
            at time zone s.timezone;
  -- counted from the company end time, or from the arrival for someone who came in after it
  new.overtime_minutes := greatest(0, floor(extract(epoch from (new.clock_out - greatest(end_ts, new.clock_in))) / 60))::int;
  return new;
end;
$$;

drop trigger if exists attendance_overtime_sync on public.attendance;
create trigger attendance_overtime_sync
  before insert or update on public.attendance
  for each row execute function public.attendance_overtime_sync();

-- ---------------------------------------------------------------------
-- 2. Network rule as a reusable check, and clock rules that know about online days
-- ---------------------------------------------------------------------
create or replace function public.assert_company_network()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.company_settings;
  ip inet;
begin
  select * into s from public.company_settings where id = 1;
  if not s.require_company_network then
    return;
  end if;
  ip := public.trusted_client_ip();
  if ip is null then
    raise exception 'Could not verify your network address. Please try again.' using errcode = 'LP001';
  end if;
  if not exists (select 1 from public.allowed_networks n where n.is_active and ip <<= n.network) then
    raise exception 'You can only do this while connected to the company wifi.' using errcode = 'LP001';
  end if;
end;
$$;

drop function if exists public.assert_clock_allowed(uuid, text, uuid);
create or replace function public.assert_clock_allowed(
  p_employee_id uuid,
  p_action text,
  p_verification uuid,
  p_online boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.company_settings;
  hit uuid;
begin
  select * into s from public.company_settings where id = 1;

  if not p_online then
    perform public.assert_company_network();
  end if;

  if s.require_biometric then
    if p_verification is null then
      raise exception 'Face ID / fingerprint verification is required.' using errcode = 'LP002';
    end if;
    update public.biometric_verifications v
       set used_at = now()
     where v.id = p_verification
       and v.employee_id = p_employee_id
       and v.action = p_action
       and v.used_at is null
       and v.expires_at > now()
     returning v.id into hit;
    if hit is null then
      raise exception 'Verification expired or invalid. Please verify again.' using errcode = 'LP002';
    end if;
    return true;
  end if;

  return false;
end;
$$;

drop function if exists public.clock_in(uuid);
create or replace function public.clock_in(p_verification uuid default null, p_online boolean default false)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp public.employees;
  s public.company_settings;
  rec public.attendance;
  bio boolean;
begin
  select * into emp
  from public.employees
  where auth_user_id = auth.uid() and is_active;

  if not found then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;

  select * into s from public.company_settings where id = 1;
  if p_online and not s.allow_online_days then
    raise exception 'Online work days are switched off. Please clock in at the company.' using errcode = 'P0001';
  end if;

  bio := public.assert_clock_allowed(emp.id, 'clock_in', p_verification, coalesce(p_online, false));

  insert into public.attendance (employee_id, work_date, clock_in, clock_in_ip, clock_in_biometric, work_mode)
  values (emp.id, (now() at time zone coalesce(s.timezone, 'UTC'))::date, now(), public.request_ip(), bio,
          case when p_online then 'online' else 'office' end)
  returning * into rec;

  if p_online then
    perform public.log_audit('attendance.online_day', emp.id, 'Started an online work day',
      jsonb_build_object('attendance_id', rec.id, 'work_date', rec.work_date));
  end if;

  return rec;
exception
  when unique_violation then
    raise exception 'You have already clocked in today.' using errcode = '23505';
end;
$$;

create or replace function public.clock_out(p_verification uuid default null)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp_id uuid;
  rec public.attendance;
  ts timestamptz := now();
  bio boolean;
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

  bio := public.assert_clock_allowed(emp_id, 'clock_out', p_verification, rec.work_mode = 'online');

  update public.attendance
     set clock_out           = ts,
         clockout_type       = 'manual',
         clock_out_ip        = public.request_ip(),
         clock_out_biometric = bio,
         worked_minutes      = greatest(0, floor(extract(epoch from (ts - clock_in)) / 60))::int
   where id = rec.id
   returning * into rec;

  if rec.overtime_started_at is not null then
    perform public.log_audit('attendance.overtime', emp_id,
      'Worked ' || rec.overtime_minutes || ' minutes of overtime on ' || rec.work_date,
      jsonb_build_object('attendance_id', rec.id, 'work_date', rec.work_date,
                         'overtime_minutes', rec.overtime_minutes,
                         'overtime_started_at', rec.overtime_started_at, 'clock_out', rec.clock_out));
  end if;

  return rec;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Log overtime
-- ---------------------------------------------------------------------
create or replace function public.start_overtime()
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp_id uuid;
  s public.company_settings;
  rec public.attendance;
  end_date date;
  end_ts timestamptz;
  cap_ts timestamptz;
begin
  emp_id := public.current_employee_id();
  if emp_id is null then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;

  select * into s from public.company_settings where id = 1;

  select * into rec
  from public.attendance
  where employee_id = emp_id
  order by work_date desc
  limit 1
  for update;

  if not found then
    raise exception 'You have not clocked in today.' using errcode = 'P0001';
  end if;
  if rec.work_mode = 'online' then
    raise exception 'Overtime can only be logged on a day you worked at the company.' using errcode = 'P0001';
  end if;

  end_date := rec.work_date + case when s.work_end_time <= s.work_start_time then 1 else 0 end;
  end_ts := (end_date + s.work_end_time) at time zone s.timezone;
  cap_ts := ((end_date + 1)::timestamp) at time zone s.timezone;   -- midnight after the end time

  if now() >= cap_ts then
    raise exception 'You have not clocked in today.' using errcode = 'P0001';
  end if;
  if now() < end_ts then
    raise exception 'Overtime can be logged after %.', to_char(s.work_end_time, 'HH24:MI') using errcode = 'P0001';
  end if;
  if rec.overtime_started_at is not null then
    raise exception 'Overtime is already logged for today.' using errcode = 'P0001';
  end if;
  if rec.clock_out is not null and rec.clockout_type is distinct from 'automatic' then
    raise exception 'You already clocked out today.' using errcode = 'P0001';
  end if;

  perform public.assert_company_network();

  update public.attendance
     set overtime_started_at = now(),
         clock_out           = null,
         clockout_type       = null,
         worked_minutes      = null
   where id = rec.id
   returning * into rec;

  perform public.log_audit('attendance.overtime_start', emp_id,
    'Started overtime after ' || to_char(s.work_end_time, 'HH24:MI'),
    jsonb_build_object('attendance_id', rec.id, 'work_date', rec.work_date, 'overtime_started_at', rec.overtime_started_at));

  return rec;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Automatic clock-out: days with logged overtime stay open until midnight
-- ---------------------------------------------------------------------
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
  cap_ts timestamptz;
  closed integer := 0;
begin
  delete from public.webauthn_challenges     where created_at < now() - interval '1 hour';
  delete from public.biometric_verifications where created_at < now() - interval '1 day';

  select * into s from public.company_settings where id = 1;
  if not found then
    return 0;
  end if;

  for r in
    select * from public.attendance
    where clock_out is null
    for update skip locked
  loop
    end_date := r.work_date + case when s.work_end_time <= s.work_start_time then 1 else 0 end;
    end_ts := (end_date + s.work_end_time) at time zone s.timezone;
    cap_ts := ((end_date + 1)::timestamp) at time zone s.timezone;

    if r.overtime_started_at is null and now() >= end_ts then
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

    elsif r.overtime_started_at is not null and now() >= cap_ts then
      -- Overtime was started but the person never clocked out: close at the company end time, no overtime counted.
      end_ts := greatest(end_ts, r.clock_in);

      update public.attendance
         set clock_out      = end_ts,
             clockout_type  = 'automatic',
             worked_minutes = floor(extract(epoch from (end_ts - r.clock_in)) / 60)::int
       where id = r.id;

      insert into public.audit_logs (actor_user_id, employee_id, action, description, metadata)
      values (null, r.employee_id, 'attendance.overtime_unconfirmed',
              'Overtime was started but never ended with a clock-out; no overtime was counted',
              jsonb_build_object('attendance_id', r.id, 'clock_out', end_ts,
                                 'overtime_started_at', r.overtime_started_at));

      closed := closed + 1;
    end if;
  end loop;

  return closed;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Settings accessor (adds allow_online_days) and audit scope
-- ---------------------------------------------------------------------
drop function if exists public.get_app_settings();
create function public.get_app_settings()
returns table (
  company_name text,
  work_start_time time,
  work_end_time time,
  timezone text,
  require_company_network boolean,
  require_biometric boolean,
  allow_online_days boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.company_name, s.work_start_time, s.work_end_time, s.timezone,
         s.require_company_network, s.require_biometric, s.allow_online_days
  from public.company_settings s
  where s.id = 1
    and auth.uid() is not null;
$$;

-- CEOs read the important audit entries: finished overtime is one of them.
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
    'attendance.overtime',
    'leave.cancel'
  ]);
$$;

-- ---------------------------------------------------------------------
-- 6. Function privileges
-- ---------------------------------------------------------------------
revoke all on function public.attendance_overtime_sync()                         from public, anon, authenticated;
revoke all on function public.assert_company_network()                           from public, anon, authenticated;
revoke all on function public.assert_clock_allowed(uuid, text, uuid, boolean)    from public, anon, authenticated;
revoke all on function public.clock_in(uuid, boolean)                            from public, anon;
revoke all on function public.clock_out(uuid)                                    from public, anon;
revoke all on function public.start_overtime()                                   from public, anon;
revoke all on function public.auto_clock_out()                                   from public, anon, authenticated;
revoke all on function public.get_app_settings()                                 from public, anon;
revoke all on function public.audit_is_important(text)                           from public, anon;

grant execute on function public.clock_in(uuid, boolean)                         to authenticated;
grant execute on function public.clock_out(uuid)                                 to authenticated;
grant execute on function public.start_overtime()                                to authenticated;
grant execute on function public.get_app_settings()                              to authenticated;
grant execute on function public.audit_is_important(text)                        to authenticated;

commit;
