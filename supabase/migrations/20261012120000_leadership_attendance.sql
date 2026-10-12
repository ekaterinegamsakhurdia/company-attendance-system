-- =====================================================================
-- Looper Agency, migration 4
--   CEOs and developers are part of attendance (they clock in, appear in the
--   daily overview, reports, corrections and auto clock-out).
--   clock_in() / clock_out() already accept any active account, so what
--   changes here is VISIBILITY and who may change what:
--
--   * CEOs can now see every account and every attendance record, including
--     the developer's. (Migration 3 hid developer accounts from CEOs.)
--   * That access is read-only: only a developer can change a developer
--     account, a developer's attendance, or remove a developer's registered
--     device. Everything else a developer can do stays developer-only.
--   * No schema change, nothing to backfill.
--
-- Safe to run more than once, on a database that has migrations 1-3.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Who may read accounts: own row, admins (CEO / developer), department head
-- ---------------------------------------------------------------------
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_ceo()                                   -- CEO or developer
    or (department_id is not null and department_id = public.head_department_id())
  );

-- ---------------------------------------------------------------------
-- 2. Read-only for CEOs: a developer's attendance and devices
-- ---------------------------------------------------------------------
create or replace function public.assert_can_change_attendance_of(p_employee_id uuid)
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
    raise exception 'Only a developer can change a developer''s attendance.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_can_change_attendance_of(uuid) from public, anon, authenticated;

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
    perform public.assert_can_change_attendance_of(p_employee_id);

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
    perform public.assert_can_change_attendance_of(before_row.employee_id);

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
  if not found then
    raise exception 'Attendance record not found.' using errcode = 'P0002';
  end if;
  perform public.assert_can_change_attendance_of(before_row.employee_id);

  delete from public.attendance where id = p_attendance_id;

  perform public.log_audit('attendance.delete', before_row.employee_id,
    'CEO deleted attendance record: ' || trim(p_reason),
    jsonb_build_object('attendance_id', before_row.id, 'reason', trim(p_reason), 'old', to_jsonb(before_row)));
end;
$$;

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
    if not public.is_developer()
       and exists (select 1 from public.employees e where e.id = c.employee_id and e.role = 'developer') then
      raise exception 'Only a developer can remove a developer''s device.' using errcode = '42501';
    end if;
  end if;

  delete from public.webauthn_credentials where id = p_credential_id;

  perform public.log_audit('webauthn.remove', c.employee_id, 'Biometric device removed: ' || c.device_name,
    jsonb_build_object('credential_row_id', c.id, 'device_name', c.device_name));
end;
$$;

revoke all on function public.ceo_save_attendance(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.ceo_delete_attendance(uuid, text)                               from public, anon;
revoke all on function public.remove_webauthn_credential(uuid)                                from public, anon;
grant execute on function public.ceo_save_attendance(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.ceo_delete_attendance(uuid, text)                               to authenticated;
grant execute on function public.remove_webauthn_credential(uuid)                                to authenticated;

commit;
