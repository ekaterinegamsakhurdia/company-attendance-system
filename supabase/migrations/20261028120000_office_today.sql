-- =====================================================================
-- Looper Agency, migration 10: "Office today" map
--
--   office_today(): for every signed-in, active person, one row per active
--   employee. Only the people who are clocked in right now (today, not yet
--   clocked out) come with a name, photo and work mode; everybody else is an
--   anonymous row (present = false) so the map can show an empty seat without
--   telling colleagues who is away, ill or on leave.
--
--   Employees cannot read each other's attendance, so this is a deliberately
--   narrow SECURITY DEFINER function: no times, no IP addresses, no leave
--   information, nothing that is not already visible on the office floor.
--
-- Safe to run more than once, on a database that has migrations 1-9.
-- =====================================================================

begin;

create or replace function public.office_today()
returns table (
  seat            integer,
  role            text,
  department_id   uuid,
  department_name text,
  present         boolean,
  employee_id     uuid,
  first_name      text,
  last_name       text,
  avatar_path     text,
  work_mode       text,
  overtime        boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_employee_id() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  return query
  with here as (
    select a.employee_id, a.work_mode, (a.overtime_started_at is not null) as overtime
    from public.attendance a
    where a.work_date = public.company_today()
      and a.clock_out is null
  )
  select
    row_number() over (partition by e.role, e.department_id order by e.employee_number)::integer as seat,
    e.role,
    e.department_id,
    d.name,
    (h.employee_id is not null) as present,
    case when h.employee_id is not null then e.id end,
    case when h.employee_id is not null then e.first_name end,
    case when h.employee_id is not null then e.last_name end,
    case when h.employee_id is not null then p.avatar_path end,
    h.work_mode,
    coalesce(h.overtime, false)
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join here h on h.employee_id = e.id
  left join public.employee_profiles p on p.employee_id = e.id and h.employee_id is not null
  where e.is_active
  order by e.role, d.name nulls last, e.employee_number;
end;
$$;

revoke all on function public.office_today() from public, anon;
grant execute on function public.office_today() to authenticated;

commit;
