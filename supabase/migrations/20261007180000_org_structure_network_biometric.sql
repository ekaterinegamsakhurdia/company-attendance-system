-- =====================================================================
-- Looper Agency, migration 2
--   1. Departments: the five departments, one head each
--   2. Job roles inside a department (Production: Montage / Operator / Motion Designer)
--   3. Department heads can READ their own department's attendance
--   4. Allowed company networks (IP / CIDR list) + enforcement on clock-in/out
--   5. WebAuthn (Face ID / fingerprint) tables + one-time verification tokens
--
-- Enforcement is OFF after this migration (company_settings.require_company_network
-- and require_biometric default to false) so nobody is locked out at deploy time.
-- The CEO switches them on in Settings once networks are listed and devices enrolled.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Departments
-- ---------------------------------------------------------------------
create unique index if not exists departments_name_lower_uidx
  on public.departments (lower(name));

alter table public.departments
  add column if not exists head_employee_id uuid references public.employees(id) on delete set null;

-- A person can head at most one department.
create unique index if not exists departments_head_uidx
  on public.departments (head_employee_id) where head_employee_id is not null;

insert into public.departments (name)
select v
from (values ('Advertising'), ('Account Managers'), ('Production'), ('Copywriting'), ('Design')) as t(v)
where not exists (select 1 from public.departments d where lower(d.name) = lower(t.v));

-- The head must be an active member of the department they head.
create or replace function public.departments_validate_head()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.head_employee_id is not null then
    if not exists (
      select 1 from public.employees e
      where e.id = new.head_employee_id
        and e.is_active
        and e.department_id = new.id
    ) then
      raise exception 'The department head must be an active employee of this department.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists departments_validate_head_trg on public.departments;
create trigger departments_validate_head_trg
  before insert or update of head_employee_id on public.departments
  for each row execute function public.departments_validate_head();

-- ---------------------------------------------------------------------
-- 2. Job roles
-- ---------------------------------------------------------------------
create table if not exists public.job_roles (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 80),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, department_id)
);
create unique index if not exists job_roles_dept_name_uidx
  on public.job_roles (department_id, lower(name));

alter table public.employees add column if not exists job_role_id uuid;

-- Composite FK: the role must belong to the employee's own department.
alter table public.employees drop constraint if exists employees_job_role_fkey;
alter table public.employees
  add constraint employees_job_role_fkey
  foreign key (job_role_id, department_id) references public.job_roles (id, department_id);

-- (MATCH SIMPLE skips the FK when a column is NULL, so forbid role-without-department explicitly.)
alter table public.employees drop constraint if exists employees_job_role_needs_department_chk;
alter table public.employees
  add constraint employees_job_role_needs_department_chk
  check (job_role_id is null or department_id is not null);

insert into public.job_roles (department_id, name)
select d.id, r.name
from public.departments d
cross join (values ('Montage'), ('Operator'), ('Motion Designer')) as r(name)
where lower(d.name) = 'production'
  and not exists (
    select 1 from public.job_roles j where j.department_id = d.id and lower(j.name) = lower(r.name)
  );

-- Moving an employee to another department drops their job role and any headship.
create or replace function public.employees_department_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.department_id is distinct from old.department_id and new.job_role_id is not distinct from old.job_role_id then
    new.job_role_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_department_change_trg on public.employees;
create trigger employees_department_change_trg
  before update on public.employees
  for each row execute function public.employees_department_change();

create or replace function public.employees_clear_head()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.department_id is distinct from old.department_id)
     or (old.is_active and not new.is_active) then
    update public.departments d
       set head_employee_id = null
     where d.head_employee_id = new.id
       and (not new.is_active or d.id is distinct from new.department_id);
  end if;
  return new;
end;
$$;

drop trigger if exists employees_clear_head_trg on public.employees;
create trigger employees_clear_head_trg
  after update on public.employees
  for each row execute function public.employees_clear_head();

drop trigger if exists job_roles_updated_at_trg on public.job_roles;
create trigger job_roles_updated_at_trg before update on public.job_roles
  for each row execute function public.set_updated_at();
drop trigger if exists job_roles_audit_trg on public.job_roles;
create trigger job_roles_audit_trg
  after insert or update on public.job_roles
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- 3. Allowed networks + settings flags
-- ---------------------------------------------------------------------
create table if not exists public.allowed_networks (
  id         uuid primary key default gen_random_uuid(),
  label      text not null check (length(trim(label)) between 1 and 80),
  network    cidr not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Carry over the single IP that was stored in company_settings.company_public_ip.
insert into public.allowed_networks (label, network)
select 'Office (migrated)',
       network(set_masklen(s.company_public_ip, case when family(s.company_public_ip) = 4 then 32 else 128 end))
from public.company_settings s
where s.id = 1 and s.company_public_ip is not null
on conflict (network) do nothing;

alter table public.company_settings
  add column if not exists require_company_network boolean not null default false,
  add column if not exists require_biometric       boolean not null default false;

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
  if new.require_company_network
     and not exists (select 1 from public.allowed_networks where is_active) then
    raise exception 'Add at least one active company network before requiring it.' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Never let the last active network disappear while the rule is on (that would lock everyone out).
create or replace function public.allowed_networks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_active
     and (tg_op = 'DELETE' or not new.is_active)
     and exists (select 1 from public.company_settings where id = 1 and require_company_network)
     and not exists (select 1 from public.allowed_networks n where n.is_active and n.id <> old.id) then
    raise exception 'This is the last active network. Turn off "require company network" first.'
      using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists allowed_networks_guard_trg on public.allowed_networks;
create trigger allowed_networks_guard_trg
  before update or delete on public.allowed_networks
  for each row execute function public.allowed_networks_guard();
drop trigger if exists allowed_networks_updated_at_trg on public.allowed_networks;
create trigger allowed_networks_updated_at_trg before update on public.allowed_networks
  for each row execute function public.set_updated_at();
drop trigger if exists allowed_networks_audit_trg on public.allowed_networks;
create trigger allowed_networks_audit_trg
  after insert or update or delete on public.allowed_networks
  for each row execute function public.audit_row_change();

-- Only the IP header that Cloudflare sets (clients cannot forge it) is trusted for enforcement.
-- No fallbacks: when it is missing the check fails closed.
create or replace function public.trusted_client_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  headers_text text := current_setting('request.headers', true);
  candidate text;
begin
  if headers_text is null or headers_text = '' then
    return null;
  end if;
  candidate := nullif(trim((headers_text::json) ->> 'cf-connecting-ip'), '');
  if candidate is null then
    return null;
  end if;
  return candidate::inet;
exception when others then
  return null;
end;
$$;

create or replace function public.my_network_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ip inet := public.trusted_client_ip();
  s public.company_settings;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  select * into s from public.company_settings where id = 1;
  return jsonb_build_object(
    'ip', case when ip is null then null else host(ip) end,
    'required', coalesce(s.require_company_network, false),
    'on_company_network', ip is not null and exists (
      select 1 from public.allowed_networks n where n.is_active and ip <<= n.network
    )
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4. WebAuthn (Face ID / fingerprint). Written only by the Edge Function (service role).
-- ---------------------------------------------------------------------
create table if not exists public.webauthn_credentials (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  credential_id text not null unique,          -- base64url
  public_key    text not null,                 -- base64url COSE key
  counter       bigint not null default 0,
  transports    text[],
  device_name   text not null check (length(trim(device_name)) between 1 and 80),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists webauthn_credentials_employee_idx on public.webauthn_credentials (employee_id);

create table if not exists public.webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  purpose     text not null check (purpose in ('register', 'clock_in', 'clock_out')),
  challenge   text not null,
  created_at  timestamptz not null default now()
);

-- One-time proof that the employee just passed a biometric check.
create table if not exists public.biometric_verifications (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  action        text not null check (action in ('clock_in', 'clock_out')),
  credential_id uuid references public.webauthn_credentials(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '2 minutes'),
  used_at       timestamptz
);

alter table public.attendance
  add column if not exists clock_in_biometric  boolean not null default false,
  add column if not exists clock_out_biometric boolean not null default false;

-- ---------------------------------------------------------------------
-- 5. RLS: head visibility, new tables
-- ---------------------------------------------------------------------
create or replace function public.head_department_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.departments d
  where d.head_employee_id = public.current_employee_id()
  limit 1;
$$;

create or replace function public.in_my_headed_department(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and e.department_id is not null
      and e.department_id = public.head_department_id()
  );
$$;

drop policy if exists employees_select  on public.employees;
drop policy if exists attendance_select on public.attendance;

create policy employees_select on public.employees
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_ceo()
    or (department_id is not null and department_id = public.head_department_id())
  );

create policy attendance_select on public.attendance
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_ceo()
    or (employee_id is not null and public.in_my_headed_department(employee_id))
  );

alter table public.job_roles               enable row level security;
alter table public.allowed_networks        enable row level security;
alter table public.webauthn_credentials    enable row level security;
alter table public.webauthn_challenges     enable row level security;
alter table public.biometric_verifications enable row level security;

create policy job_roles_select on public.job_roles
  for select to authenticated using (true);
create policy job_roles_ceo_insert on public.job_roles
  for insert to authenticated with check (public.is_ceo());
create policy job_roles_ceo_update on public.job_roles
  for update to authenticated using (public.is_ceo()) with check (public.is_ceo());

create policy allowed_networks_ceo_select on public.allowed_networks
  for select to authenticated using (public.is_ceo());
create policy allowed_networks_ceo_insert on public.allowed_networks
  for insert to authenticated with check (public.is_ceo());
create policy allowed_networks_ceo_update on public.allowed_networks
  for update to authenticated using (public.is_ceo()) with check (public.is_ceo());
create policy allowed_networks_ceo_delete on public.allowed_networks
  for delete to authenticated using (public.is_ceo());

-- Devices: employees see their own, the CEO sees all. The public key never leaves the server.
create policy webauthn_credentials_select on public.webauthn_credentials
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.is_ceo());

revoke all on public.job_roles, public.allowed_networks, public.webauthn_credentials,
              public.webauthn_challenges, public.biometric_verifications from anon;
revoke insert, update, delete, truncate on public.job_roles from authenticated; -- re-granted below
grant select, insert, update on public.job_roles to authenticated;
revoke truncate on public.allowed_networks from authenticated;
revoke all on public.webauthn_credentials from authenticated;
grant select (id, employee_id, device_name, created_at, last_used_at) on public.webauthn_credentials to authenticated;
revoke all on public.webauthn_challenges, public.biometric_verifications from authenticated;

-- ---------------------------------------------------------------------
-- 6. Settings accessor (adds the two flags)
-- ---------------------------------------------------------------------
drop function if exists public.get_app_settings();
create function public.get_app_settings()
returns table (
  company_name text,
  work_start_time time,
  work_end_time time,
  timezone text,
  require_company_network boolean,
  require_biometric boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.company_name, s.work_start_time, s.work_end_time, s.timezone,
         s.require_company_network, s.require_biometric
  from public.company_settings s
  where s.id = 1
    and auth.uid() is not null;
$$;

-- ---------------------------------------------------------------------
-- 7. Clock-in / clock-out with enforcement
-- ---------------------------------------------------------------------
-- SQLSTATE 'LP001' = not on company network, 'LP002' = biometric verification missing/invalid.
create or replace function public.assert_clock_allowed(p_employee_id uuid, p_action text, p_verification uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.company_settings;
  ip inet;
  hit uuid;
begin
  select * into s from public.company_settings where id = 1;

  if s.require_company_network then
    ip := public.trusted_client_ip();
    if ip is null then
      raise exception 'Could not verify your network address. Please try again.' using errcode = 'LP001';
    end if;
    if not exists (select 1 from public.allowed_networks n where n.is_active and ip <<= n.network) then
      raise exception 'You can only clock in or out while connected to the company wifi.' using errcode = 'LP001';
    end if;
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

drop function if exists public.clock_in();
drop function if exists public.clock_out();

create function public.clock_in(p_verification uuid default null)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp public.employees;
  tz text;
  rec public.attendance;
  bio boolean;
begin
  select * into emp
  from public.employees
  where auth_user_id = auth.uid() and is_active;

  if not found then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;

  bio := public.assert_clock_allowed(emp.id, 'clock_in', p_verification);

  select s.timezone into tz from public.company_settings s where s.id = 1;

  insert into public.attendance (employee_id, work_date, clock_in, clock_in_ip, clock_in_biometric)
  values (emp.id, (now() at time zone coalesce(tz, 'UTC'))::date, now(), public.request_ip(), bio)
  returning * into rec;

  return rec;
exception
  when unique_violation then
    raise exception 'You have already clocked in today.' using errcode = '23505';
end;
$$;

create function public.clock_out(p_verification uuid default null)
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

  bio := public.assert_clock_allowed(emp_id, 'clock_out', p_verification);

  update public.attendance
     set clock_out           = ts,
         clockout_type       = 'manual',
         clock_out_ip        = public.request_ip(),
         clock_out_biometric = bio,
         worked_minutes      = greatest(0, floor(extract(epoch from (ts - clock_in)) / 60))::int
   where id = rec.id
   returning * into rec;

  return rec;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. CEO / self-service RPCs
-- ---------------------------------------------------------------------
create or replace function public.ceo_set_department_head(p_department_id uuid, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_head uuid;
begin
  if not public.is_ceo() then
    raise exception 'Only the CEO can set department heads.' using errcode = '42501';
  end if;

  select head_employee_id into old_head from public.departments where id = p_department_id;
  if not found then
    raise exception 'Department not found.' using errcode = 'P0002';
  end if;

  update public.departments set head_employee_id = p_employee_id where id = p_department_id;

  perform public.log_audit('department.head', coalesce(p_employee_id, old_head), 'Department head changed',
    jsonb_build_object('department_id', p_department_id, 'old_head', old_head, 'new_head', p_employee_id));
exception
  when unique_violation then
    raise exception 'This employee already heads another department.' using errcode = '23505';
end;
$$;

create or replace function public.ceo_set_employee_job_role(p_employee_id uuid, p_job_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp_dept uuid;
  role_dept uuid;
  role_active boolean;
  old_role uuid;
begin
  if not public.is_ceo() then
    raise exception 'Only the CEO can change job roles.' using errcode = '42501';
  end if;

  select department_id, job_role_id into emp_dept, old_role from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;

  if p_job_role_id is not null then
    select department_id, is_active into role_dept, role_active from public.job_roles where id = p_job_role_id;
    if not found then
      raise exception 'Job role not found.' using errcode = 'P0002';
    end if;
    if emp_dept is distinct from role_dept then
      raise exception 'This job role belongs to a different department than the employee.' using errcode = '22023';
    end if;
    if not role_active then
      raise exception 'This job role is inactive.' using errcode = '22023';
    end if;
  end if;

  update public.employees set job_role_id = p_job_role_id where id = p_employee_id;

  perform public.log_audit('employee.job_role', p_employee_id, 'Job role changed',
    jsonb_build_object('old_job_role_id', old_role, 'new_job_role_id', p_job_role_id));
end;
$$;

create or replace function public.ceo_add_my_network(p_label text)
returns public.allowed_networks
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip inet := public.trusted_client_ip();
  net cidr;
  rec public.allowed_networks;
begin
  if not public.is_ceo() then
    raise exception 'Only the CEO can manage networks.' using errcode = '42501';
  end if;
  if ip is null then
    raise exception 'Could not detect your public IP address from this connection.' using errcode = 'P0001';
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'A label is required.' using errcode = '22023';
  end if;

  -- IPv4: this exact address. IPv6: the /64 prefix (devices on one wifi share it).
  net := network(set_masklen(ip, case when family(ip) = 4 then 32 else 64 end));

  insert into public.allowed_networks (label, network)
  values (trim(p_label), net)
  on conflict (network) do update set is_active = true, label = excluded.label
  returning * into rec;

  return rec;
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
  if c.employee_id is distinct from public.current_employee_id() and not public.is_ceo() then
    raise exception 'You can only remove your own devices.' using errcode = '42501';
  end if;

  delete from public.webauthn_credentials where id = p_credential_id;

  perform public.log_audit('webauthn.remove', c.employee_id, 'Biometric device removed: ' || c.device_name,
    jsonb_build_object('credential_row_id', c.id, 'device_name', c.device_name));
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Housekeeping inside the existing cron job
-- ---------------------------------------------------------------------
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
-- 10. Function privileges
-- ---------------------------------------------------------------------
revoke all on function public.head_department_id()                   from public, anon;
revoke all on function public.in_my_headed_department(uuid)          from public, anon;
revoke all on function public.trusted_client_ip()                    from public, anon;
revoke all on function public.my_network_status()                    from public, anon;
revoke all on function public.get_app_settings()                     from public, anon;
revoke all on function public.assert_clock_allowed(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.clock_in(uuid)                         from public, anon;
revoke all on function public.clock_out(uuid)                        from public, anon;
revoke all on function public.ceo_set_department_head(uuid, uuid)    from public, anon;
revoke all on function public.ceo_set_employee_job_role(uuid, uuid)  from public, anon;
revoke all on function public.ceo_add_my_network(text)               from public, anon;
revoke all on function public.remove_webauthn_credential(uuid)       from public, anon;
revoke all on function public.auto_clock_out()                       from public, anon, authenticated;

grant execute on function public.head_department_id()                  to authenticated;
grant execute on function public.in_my_headed_department(uuid)         to authenticated;
grant execute on function public.trusted_client_ip()                   to authenticated;
grant execute on function public.my_network_status()                   to authenticated;
grant execute on function public.get_app_settings()                    to authenticated;
grant execute on function public.clock_in(uuid)                        to authenticated;
grant execute on function public.clock_out(uuid)                       to authenticated;
grant execute on function public.ceo_set_department_head(uuid, uuid)   to authenticated;
grant execute on function public.ceo_set_employee_job_role(uuid, uuid) to authenticated;
grant execute on function public.ceo_add_my_network(text)              to authenticated;
grant execute on function public.remove_webauthn_credential(uuid)      to authenticated;

commit;
