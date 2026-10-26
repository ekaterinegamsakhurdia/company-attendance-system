\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.headers', '{"x-forwarded-for":"198.51.100.1"}', false);
end $$;
create or replace function pg_temp.expect_error(q text, needle text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if position(lower(needle) in lower(sqlerrm || ' ' || sqlstate)) > 0 then return; end if;
    raise exception 'wrong error for [%]: % (%)', q, sqlerrm, sqlstate;
  end;
  raise exception 'expected error [%] containing "%" but it succeeded', q, needle;
end $$;
grant execute on function pg_temp.expect_error(text, text) to public;

\echo '--- part 10 checks start (office today)'
reset role;
\set ceo  '''00000000-0000-0000-0000-0000000000c1'''
\set dev  '''00000000-0000-0000-0000-0000000000f1'''
\set a    '''33000000-0000-0000-0000-000000000002'''
\set b    '''33000000-0000-0000-0000-000000000003'''
\set head '''33000000-0000-0000-0000-000000000001'''

update public.company_settings set require_company_network = false, require_biometric = false, allow_online_days = true,
  timezone = 'Asia/Tbilisi', work_start_time = '00:00', work_end_time = '23:59';
delete from public.attendance;
update public.employee_profiles set avatar_path = 'u-a/photo.jpg' where employee_id = '34000000-0000-0000-0000-000000000002';

-- nobody in yet: everybody is an anonymous empty seat
select pg_temp.as_user(:b);
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.office_today();
  if n < 5 then raise exception 'expected a row per active employee, got %', n; end if;
  if exists (select 1 from public.office_today() where present or first_name is not null or employee_id is not null) then
    raise exception 'someone shows up before clocking in'; end if;
end $$;
reset role;

-- A works at the company, B works online, the head is clocked in then out
select pg_temp.as_user(:a);
set role authenticated;
select public.clock_in();
reset role;
select pg_temp.as_user(:b);
set role authenticated;
select public.clock_in(null, true);
reset role;
select pg_temp.as_user(:head);
set role authenticated;
select public.clock_in();
select public.clock_out();
reset role;

-- a colleague (who cannot read the attendance table) sees exactly A and B, with status and photo
select pg_temp.as_user(:b);
set role authenticated;
do $$ declare r record; begin
  if (select count(*) from public.attendance where employee_id <> (select id from public.employees where auth_user_id = auth.uid())) <> 0 then
    raise exception 'precondition: employees must not read colleagues'' attendance'; end if;
  if (select count(*) from public.office_today() where present) <> 2 then raise exception 'present count %', (select count(*) from public.office_today() where present); end if;
  select * into r from public.office_today() where employee_id = '34000000-0000-0000-0000-000000000002';
  if r.work_mode <> 'office' or r.first_name <> 'Ann' or r.avatar_path <> 'u-a/photo.jpg' or r.department_name <> 'Card Lab' then raise exception 'row A: %', to_jsonb(r); end if;
  select * into r from public.office_today() where employee_id = '34000000-0000-0000-0000-000000000003';
  if r.work_mode <> 'online' then raise exception 'row B: %', to_jsonb(r); end if;
  if exists (select 1 from public.office_today() where employee_id = '34000000-0000-0000-0000-000000000001') then raise exception 'clocked-out head still on the map'; end if;
  -- absent people are anonymous
  if exists (select 1 from public.office_today() where not present and (employee_id is not null or first_name is not null or last_name is not null or avatar_path is not null or work_mode is not null)) then
    raise exception 'an absent person is identifiable'; end if;
end $$;
reset role;

-- same view for the CEO and the developer
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin if (select count(*) from public.office_today() where present) <> 2 then raise exception 'ceo view'; end if; end $$;
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin if (select count(*) from public.office_today() where present) <> 2 then raise exception 'dev view'; end if; end $$;
reset role;

-- clocking out removes the bubble, clocking in again brings it back
select pg_temp.as_user(:a);
set role authenticated;
select public.clock_out();
do $$ begin if exists (select 1 from public.office_today() where employee_id = '34000000-0000-0000-0000-000000000002') then raise exception 'bubble stays after clock-out'; end if; end $$;
reset role;
-- (a re-opened overtime day counts as present again, and says so)
update public.attendance set clock_out = null, clockout_type = null, worked_minutes = null, overtime_started_at = now()
 where employee_id = '34000000-0000-0000-0000-000000000002';
select pg_temp.as_user(:b);
set role authenticated;
do $$ begin
  if not exists (select 1 from public.office_today() where employee_id = '34000000-0000-0000-0000-000000000002' and overtime) then raise exception 'bubble missing for open day'; end if;
end $$;
reset role;

-- deactivated people disappear completely
update public.employees set is_active = false where id = '34000000-0000-0000-0000-000000000003';
select pg_temp.as_user(:a);
set role authenticated;
do $$ begin
  if exists (select 1 from public.office_today() where employee_id = '34000000-0000-0000-0000-000000000003') then raise exception 'inactive person on the map'; end if;
end $$;
reset role;
update public.employees set is_active = true where id = '34000000-0000-0000-0000-000000000003';

-- anonymous callers are refused
set role anon;
select pg_temp.expect_error($$select * from public.office_today()$$, 'permission denied');
reset role;
-- a login without an active employee profile is refused
select pg_temp.as_user('00000000-0000-0000-0000-00000000dead');
set role authenticated;
select pg_temp.expect_error($$select * from public.office_today()$$, 'Not signed in');
reset role;

select pg_temp.as_user(:ceo);
update public.company_settings set work_start_time = '11:00', work_end_time = '19:00';
\echo 'PART 10 DB TESTS PASSED'
