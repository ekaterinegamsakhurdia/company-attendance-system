-- =====================================================================
-- Looper Agency, migration 12: leave days already used before the app
--
--   The balance of a leave type is "allowance - approved days - pending days", and the
--   days come from dated leave requests. When the company starts using the app part-way
--   through a year, the days people already took only exist as totals (for example
--   "18 vacation days this year"), without dates. Inventing dates for them would put
--   fake leave into the calendar and the timesheets.
--
--   leave_imported_usage stores those totals per person, year and leave type. They count
--   as approved days everywhere balances are computed (balance cards, analytics, the
--   "not enough days left" check, the approval check), but they are not requests, so they
--   never appear in the calendar.
--
--   The table is filled by a one-off import in the SQL editor (not audit-logged, there is no
--   signed-in person there). Readable by the person
--   themself and by CEOs / developers, like allowances. No client can write to it.
--
-- Safe to run more than once, on a database that has migrations 1-11.
-- =====================================================================

begin;

create table if not exists public.leave_imported_usage (
  employee_id uuid not null references public.employees(id) on delete cascade,
  year        int  not null check (year between 2000 and 2100),
  category    text not null check (category in ('vacation', 'unpaid', 'day_off')),
  days        int  not null check (days between 0 and 366),
  note        text check (note is null or length(note) <= 200),
  updated_at  timestamptz not null default now(),
  primary key (employee_id, year, category)
);

alter table public.leave_imported_usage enable row level security;

drop policy if exists leave_imported_usage_select on public.leave_imported_usage;
create policy leave_imported_usage_select on public.leave_imported_usage
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.is_ceo());

revoke all on public.leave_imported_usage from anon;
revoke insert, update, delete, truncate on public.leave_imported_usage from authenticated;
grant select on public.leave_imported_usage to authenticated;

drop trigger if exists leave_imported_usage_updated_at_trg on public.leave_imported_usage;
create trigger leave_imported_usage_updated_at_trg before update on public.leave_imported_usage
  for each row execute function public.set_updated_at();

-- Approved days = approved requests + the imported total for that year and type.
create or replace function public.leave_used_days(
  p_employee_id uuid, p_year int, p_category text, p_status text, p_exclude uuid default null
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select coalesce(sum(public.leave_days_in_year(r.start_date, r.end_date, p_year)), 0)::int
    from public.leave_requests r
    where r.employee_id = p_employee_id
      and r.category = p_category
      and r.status = p_status
      and r.id is distinct from p_exclude
  ) + case when p_status = 'approved' then coalesce((
        select u.days from public.leave_imported_usage u
        where u.employee_id = p_employee_id and u.year = p_year and u.category = p_category
      ), 0) else 0 end;
$$;

revoke all on function public.leave_used_days(uuid, int, text, text, uuid) from public, anon, authenticated;

commit;
