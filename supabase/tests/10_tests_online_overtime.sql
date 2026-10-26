\set ON_ERROR_STOP on
\set QUIET on
-- as_user(user, ip): the IP is what the Supabase gateway reports in cf-connecting-ip
create or replace function pg_temp.as_user(uid text, ip text default '203.0.113.7') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.headers', json_build_object('cf-connecting-ip', ip, 'x-forwarded-for', ip)::text, false);
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

\echo '--- part 9 checks start (online work days + overtime)'
reset role;
\set ceo  '''00000000-0000-0000-0000-0000000000c1'''
\set dev  '''00000000-0000-0000-0000-0000000000f1'''
\set head '''33000000-0000-0000-0000-000000000001'''
\set a    '''33000000-0000-0000-0000-000000000002'''
\set b    '''33000000-0000-0000-0000-000000000003'''
\set oh   '''33000000-0000-0000-0000-000000000004'''
\set outside '198.51.100.50'
\set office  '203.0.113.9'

-- A time zone in which it is about 12:xx right now, so "11:00 today" is in the past and midnight is far away.
select format('Etc/GMT%s', case when o >= 0 then '-' || o else '+' || (-o) end) as tz
  from (select 12 - extract(hour from now() at time zone 'UTC')::int as o) x \gset

select set_config('test.tz', :'tz', false);
delete from public.attendance where employee_id in (select id from public.employees where employee_number like 'CL%' or employee_number like 'OL%' or role in ('ceo','developer'));
delete from public.audit_logs;
delete from public.allowed_networks;
insert into public.allowed_networks (label, network) values ('Test office', '203.0.113.0/24');
update public.company_settings set timezone = :'tz', work_start_time = '06:00', work_end_time = '11:00',
  require_company_network = true, require_biometric = false, allow_online_days = true;

-- ===================== 1. online work days =====================
-- the feature can be switched off
update public.company_settings set allow_online_days = false;
select pg_temp.as_user(:a, :'outside');
set role authenticated;
select pg_temp.expect_error($$select public.clock_in(null, true)$$, 'switched off');
reset role;
update public.company_settings set allow_online_days = true;

-- a normal clock-in from home is still refused, an online one is not
select pg_temp.as_user(:a, :'outside');
set role authenticated;
select pg_temp.expect_error($$select public.clock_in()$$, 'LP001');
do $$ declare r public.attendance; begin
  r := public.clock_in(null, true);
  if r.work_mode <> 'online' then raise exception 'work_mode %', r.work_mode; end if;
  if r.clock_in_ip is null or host(r.clock_in_ip) <> '198.51.100.50' then raise exception 'ip not recorded'; end if;
end $$;
select pg_temp.expect_error($$select public.clock_in(null, true)$$, 'already clocked in');
-- clocking out of an online day works from anywhere
do $$ declare r public.attendance; begin
  r := public.clock_out();
  if r.clock_out is null or r.worked_minutes is null then raise exception 'online clock-out'; end if;
end $$;
-- no overtime for an online day
select pg_temp.expect_error($$select public.start_overtime()$$, 'worked at the company');
reset role;

-- the audit log says who worked online (developers see it; it is not an "important" CEO entry)
do $$ begin
  if not exists (select 1 from public.audit_logs where action = 'attendance.online_day' and employee_id = '34000000-0000-0000-0000-000000000002') then
    raise exception 'online day not audited'; end if;
end $$;

-- Face ID / fingerprint still applies to an online clock-in
update public.company_settings set require_biometric = true;
select pg_temp.as_user(:b, :'outside');
set role authenticated;
select pg_temp.expect_error($$select public.clock_in(null, true)$$, 'LP002');
reset role;
update public.company_settings set require_biometric = false;

-- who sees the online day: the person, the department head, CEO and developer; not another department's head
select pg_temp.as_user(:head);
set role authenticated;
do $$ begin
  if (select count(*) from public.attendance where work_mode = 'online') <> 1 then raise exception 'head should see the online day'; end if;
end $$;
reset role;
select pg_temp.as_user(:oh);
set role authenticated;
do $$ begin
  if (select count(*) from public.attendance where work_mode = 'online') <> 0 then raise exception 'other head sees the online day'; end if;
end $$;
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if (select count(*) from public.attendance where work_mode = 'online') <> 1 then raise exception 'CEO should see the online day'; end if;
end $$;
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  if (select count(*) from public.attendance where work_mode = 'online') <> 1 then raise exception 'developer should see the online day'; end if;
end $$;
reset role;
-- a colleague does not
select pg_temp.as_user(:b);
set role authenticated;
do $$ begin
  if (select count(*) from public.attendance where work_mode = 'online') <> 0 then raise exception 'colleague sees the online day'; end if;
end $$;
reset role;

-- ===================== 2. overtime =====================
-- too early: the end time has not come yet
update public.company_settings set work_end_time = '23:00';
select pg_temp.as_user(:b, :'office');
set role authenticated;
do $$ begin perform public.clock_in(); end $$;
select pg_temp.expect_error($$select public.start_overtime()$$, 'after 23:00');
reset role;
update public.company_settings set work_end_time = '11:00';
-- pretend B arrived at 09:00 local, so the day is well before the end time
update public.attendance set clock_in = (((now() at time zone :'tz')::date + time '09:00') at time zone :'tz')
 where employee_id = '34000000-0000-0000-0000-000000000003';

-- the wrong network is refused, the company network works
select pg_temp.as_user(:b, :'outside');
set role authenticated;
select pg_temp.expect_error($$select public.start_overtime()$$, 'LP001');
reset role;
select pg_temp.as_user(:b, :'office');
set role authenticated;
do $$ declare r public.attendance; begin
  r := public.start_overtime();
  if r.overtime_started_at is null or r.clock_out is not null or r.worked_minutes is not null then raise exception 'overtime start: %', to_jsonb(r); end if;
end $$;
select pg_temp.expect_error($$select public.start_overtime()$$, 'already logged');
reset role;

-- the automatic clock-out leaves a day with logged overtime open
do $$ declare n int; begin
  n := public.auto_clock_out();
  if (select clock_out from public.attendance where employee_id = '34000000-0000-0000-0000-000000000003') is not null then
    raise exception 'auto clock-out closed an overtime day'; end if;
end $$;

-- clocking out of overtime also needs the company network, then records the real time
select pg_temp.as_user(:b, :'outside');
set role authenticated;
select pg_temp.expect_error($$select public.clock_out()$$, 'LP001');
reset role;
select pg_temp.as_user(:b, :'office');
set role authenticated;
do $$ declare r public.attendance; want int; end_ts timestamptz; begin
  r := public.clock_out();
  end_ts := ((now() at time zone current_setting('test.tz'))::date + time '11:00') at time zone current_setting('test.tz');
  want := floor(extract(epoch from (r.clock_out - end_ts)) / 60)::int;
  if r.clockout_type <> 'manual' then raise exception 'type %', r.clockout_type; end if;
  if r.overtime_minutes <> want or want < 30 then raise exception 'overtime minutes % (want %)', r.overtime_minutes, want; end if;
  if r.worked_minutes <> floor(extract(epoch from (r.clock_out - r.clock_in)) / 60)::int then raise exception 'worked minutes'; end if;
  if r.worked_minutes < r.overtime_minutes + 120 then raise exception 'worked minutes must include the regular hours too'; end if;
end $$;
reset role;

-- audit: the finished overtime is an "important" entry (CEO sees it); the start is routine
do $$ begin
  if not exists (select 1 from public.audit_logs where action = 'attendance.overtime' and employee_id = '34000000-0000-0000-0000-000000000003'
                  and (metadata->>'overtime_minutes')::int > 0) then raise exception 'overtime not audited'; end if;
  if not exists (select 1 from public.audit_logs where action = 'attendance.overtime_start') then raise exception 'overtime start not audited'; end if;
end $$;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if not exists (select 1 from public.audit_logs where action = 'attendance.overtime') then raise exception 'CEO cannot see the overtime entry'; end if;
  if exists (select 1 from public.audit_logs where action = 'attendance.overtime_start') then raise exception 'CEO sees the routine overtime start'; end if;
end $$;
reset role;

-- a CEO correction recalculates the minutes; earlier than the end time means none
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ declare r public.attendance; row_ public.attendance; end_ts timestamptz; begin
  select * into row_ from public.attendance where employee_id = '34000000-0000-0000-0000-000000000003';
  end_ts := ((now() at time zone current_setting('test.tz'))::date + time '11:00') at time zone current_setting('test.tz');
  r := public.ceo_save_attendance(row_.id, row_.employee_id, row_.clock_in, end_ts + interval '30 minutes', 'fix the time');
  if r.overtime_minutes <> 30 then raise exception 'recalculated overtime % (want 30)', r.overtime_minutes; end if;
  r := public.ceo_save_attendance(row_.id, row_.employee_id, row_.clock_in, end_ts - interval '10 minutes', 'left earlier');
  if r.overtime_minutes <> 0 then raise exception 'overtime must be 0 before the end time, got %', r.overtime_minutes; end if;
end $$;
reset role;

-- nobody can write the columns directly
select pg_temp.as_user(:b);
set role authenticated;
select pg_temp.expect_error($$update public.attendance set overtime_minutes = 999 where employee_id = '34000000-0000-0000-0000-000000000003'$$, 'permission denied');
select pg_temp.expect_error($$update public.attendance set work_mode = 'online' where employee_id = '34000000-0000-0000-0000-000000000003'$$, 'permission denied');
reset role;

-- re-open a day the automatic clock-out already closed
insert into public.attendance (employee_id, work_date, clock_in, clock_out, clockout_type, worked_minutes)
values ('34000000-0000-0000-0000-000000000001', (now() at time zone :'tz')::date,
        ((now() at time zone :'tz')::date + time '08:00') at time zone :'tz',
        ((now() at time zone :'tz')::date + time '11:00') at time zone :'tz', 'automatic', 180);
select pg_temp.as_user(:head, :'office');
set role authenticated;
do $$ declare r public.attendance; begin
  r := public.start_overtime();
  if r.clock_out is not null or r.clockout_type is not null or r.overtime_started_at is null then raise exception 'reopen: %', to_jsonb(r); end if;
  r := public.clock_out();
  if r.overtime_minutes < 30 then raise exception 'overtime after reopening %', r.overtime_minutes; end if;
end $$;
reset role;

-- a manual clock-out earlier in the day cannot be turned into overtime
select pg_temp.as_user(:ceo, :'office');
set role authenticated;
do $$ begin perform public.clock_in(); perform public.clock_out(); end $$;
select pg_temp.expect_error($$select public.start_overtime()$$, 'already clocked out');
reset role;

-- overtime that is never ended: closed at the company end time, nothing counted
insert into public.attendance (employee_id, work_date, clock_in, overtime_started_at)
select e.id, (now() at time zone :'tz')::date - 1,
       (((now() at time zone :'tz')::date - 1) + time '09:00') at time zone :'tz',
       (((now() at time zone :'tz')::date - 1) + time '19:30') at time zone :'tz'
  from public.employees e where e.auth_user_id = '00000000-0000-0000-0000-0000000000f1';
do $$ declare r public.attendance; begin
  perform public.auto_clock_out();
  select a.* into r from public.attendance a join public.employees e on e.id = a.employee_id
   where e.auth_user_id = '00000000-0000-0000-0000-0000000000f1' and a.work_date = (now() at time zone current_setting('test.tz'))::date - 1;
  if r.clock_out is null or r.clockout_type <> 'automatic' or r.overtime_minutes <> 0 or r.worked_minutes <> 120 then
    raise exception 'unconfirmed overtime closed wrongly: %', to_jsonb(r); end if;
  if not exists (select 1 from public.audit_logs where action = 'attendance.overtime_unconfirmed') then raise exception 'unconfirmed overtime not audited'; end if;
end $$;

-- the settings accessor tells the app about the switch; anonymous users get nothing
select pg_temp.as_user(:a);
set role authenticated;
do $$ begin if not (select allow_online_days from public.get_app_settings()) then raise exception 'setting not exposed'; end if; end $$;
reset role;
set role anon;
select pg_temp.expect_error($$select public.start_overtime()$$, 'permission denied');
select pg_temp.expect_error($$select public.clock_in(null, true)$$, 'permission denied');
reset role;

-- restore sane settings for whatever runs after
update public.company_settings set timezone = 'Asia/Tbilisi', work_start_time = '11:00', work_end_time = '19:00',
  require_company_network = false, require_biometric = false;
\echo 'PART 9 DB TESTS PASSED'
