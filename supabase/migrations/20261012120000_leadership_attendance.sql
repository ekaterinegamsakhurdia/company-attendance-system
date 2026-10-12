-- =====================================================================
-- Looper Agency, migration 4
--   1. CEOs and developers are part of attendance (they clock in, appear in
--      the daily overview, reports, corrections and auto clock-out).
--      clock_in() / clock_out() already accept any active account; what
--      changes here is who may SEE and CORRECT those records:
--        * a developer's attendance is visible to developers only
--          (developer accounts stay invisible to CEOs, as before)
--        * a CEO's attendance is visible to CEOs and developers
--   2. Company networks: confirmed unlimited (no cap anywhere in the
--      database); nothing to change in the schema for that.
--
-- Safe to run once on a database that already has migrations 1-3.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Account-type snapshot on attendance rows
-- ---------------------------------------------------------------------
-- A deleted employee leaves employee_id = null behind. The snapshot lets the
-- rule "developer records are hidden from CEOs" keep working for those rows.
alter table public.attendance add column if not exists employee_role text;

update public.attendance a
   set employee_role = e.role
  from public.employees e
 where e.id = a.employee_id
   and a.employee_role is distinct from e.role;

create or replace function public.attendance_fill_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.employee_id is not null
     and (new.employee_number is null or new.employee_name is null or new.employee_role is null) then
    select e.employee_number, e.first_name || ' ' || e.last_name, e.role
      into new.employee_number, new.employee_name, new.employee_role
    from public.employees e
    where e.id = new.employee_id;
  end if;
  return new;
end;
$$;

create or replace function public.employees_sync_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.employee_number is distinct from old.employee_number
     or new.role is distinct from old.role then
    update public.attendance
       set employee_number = new.employee_number,
           employee_name   = new.first_name || ' ' || new.last_name,
           employee_role   = new.role
     where employee_id = new.id;
  end if;
  return new;
end;
$$;

-- security definer helper: policies run with the caller's rights, and a CEO
-- cannot see developer rows in public.employees, so "does a developer exist?"
-- has to be answered with elevated rights.
create or replace function public.is_developer_account(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.employees e where e.id = p_employee_id and e.role = 'developer');
$$;

revoke all on function public.is_developer_account(uuid) from public, anon;
grant execute on function public.is_developer_account(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Who may read attendance
-- ---------------------------------------------------------------------
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_developer()
    or (public.is_ceo() and employee_role is distinct from 'developer')
    or (employee_id is not null and public.in_my_headed_department(employee_id))
  );

-- Registered devices follow the same rule (a CEO must not see a developer's devices).
drop policy if exists webauthn_credentials_select on public.webauthn_credentials;
create policy webauthn_credentials_select on public.webauthn_credentials
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_developer()
    or (public.is_ceo() and not public.is_developer_account(employee_id))
  );

create or replace function public.remove_webauthn_credential(p_credential_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.webauthn_credentials;
begin
  select * into c from public.webauthn_credentials where id = p_credential_id;
  if not found then
    raise exception 'Device not found.' using errcode = 'P0002';
  end if;
  if c.employee_id is distinct from public.current_employee_id() then
    if not public.is_ceo() then
      raise exception 'You can only remove your own devices.' using errcode = '42501';
    end if;
    -- a CEO cannot see or touch a developer's devices
    if public.is_developer_account(c.employee_id) and not public.is_developer() then
      raise exception 'Device not found.' using errcode = 'P0002';
    end if;
  end if;

  delete from public.webauthn_credentials where id = p_credential_id;

  perform public.log_audit('webauthn.remove', c.employee_id, 'Biometric device removed: ' || c.device_name,
    jsonb_build_object('credential_row_id', c.id, 'device_name', c.device_name));
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Corrections: a CEO cannot create, change or delete a developer's records
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
    perform public.assert_can_manage_employee(p_employee_id);   -- hides developers from CEOs

    insert into public.attendance (employee_id, work_date, clock_in, clock_out, clockout_type, worked_minutes)
    values (p_employee_id, wd, p_clock_in, p_clock_out,
            case when p_clock_out is null then null else 'manual' end, minutes)
    returning * into rec;

    perform public.log_audit('attendance.create', rec.employee_id,
      'CEO created attendance record: ' || trim(p_reason),
      jsonb_build_object('attendance_id', rec.id, 'reason', trim(p_reason), 'new', to_jsonb(rec)));
  else
    select * into before_row from public.attendance where id = p_attendance_id for update;
    if not found
       or (before_row.employee_role = 'developer' and not public.is_developer()) then
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

  select * into before_row from public.attendance where id = p_attendance_id for update;
  if not found
     or (before_row.employee_role = 'developer' and not public.is_developer()) then
    raise exception 'Attendance record not found.' using errcode = 'P0002';
  end if;

  delete from public.attendance where id = p_attendance_id;

  perform public.log_audit('attendance.delete', before_row.employee_id,
    'CEO deleted attendance record: ' || trim(p_reason),
    jsonb_build_object('attendance_id', before_row.id, 'reason', trim(p_reason), 'old', to_jsonb(before_row)));
end;
$$;

revoke all on function public.ceo_save_attendance(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.ceo_delete_attendance(uuid, text)                               from public, anon;
revoke all on function public.remove_webauthn_credential(uuid)                                from public, anon;
grant execute on function public.ceo_save_attendance(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.ceo_delete_attendance(uuid, text)                               to authenticated;
grant execute on function public.remove_webauthn_credential(uuid)                                to authenticated;

commit;
