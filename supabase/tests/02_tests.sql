\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.expect_error(q text, needle text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm ilike '%' || needle || '%' then return; end if;
    raise exception 'wrong error for [%]: got "%", wanted "%"', q, sqlerrm, needle;
  end;
  raise exception 'expected error containing "%" but succeeded: %', needle, q;
end $$;
grant execute on function pg_temp.expect_error(text,text) to public;

-- helper to act as a user
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.7","x-forwarded-for":"198.51.100.1, 10.0.0.1"}', false);
end $$;

\echo '--- migration applied; checks start'

-- 0. legacy permissive policy is gone
do $$ begin
  if exists (select 1 from pg_policies where policyname='legacy_all') then raise exception 'legacy policy survived'; end if;
  -- (exact policy count is asserted in 03 after the second migration)
end $$;

-- 1. snapshot backfill
do $$ begin
  if (select employee_name from public.attendance limit 1) <> 'Bob B' then raise exception 'backfill failed'; end if;
end $$;

-- ===== Alice (employee) =====
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;

-- RLS: alice sees only herself and only her own (zero) attendance
do $$ begin
  if (select count(*) from public.employees) <> 1 then raise exception 'alice sees % employees', (select count(*) from public.employees); end if;
  if (select count(*) from public.attendance) <> 0 then raise exception 'alice sees others attendance'; end if;
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'alice sees audit'; end if;
  if (select count(*) from public.company_settings) <> 0 then raise exception 'alice reads settings table'; end if;
end $$;

-- direct writes are blocked
select pg_temp.expect_error($$update public.employees set role='ceo' where auth_user_id = auth.uid()$$, 'permission denied');
select pg_temp.expect_error($$insert into public.attendance(employee_id,work_date,clock_in) values ('10000000-0000-0000-0000-0000000000a1','2026-01-01',now())$$, 'permission denied');
select pg_temp.expect_error($$update public.attendance set worked_minutes=9999$$, 'permission denied');
do $$ declare n int; begin
  update public.company_settings set company_name='hacked'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'employee updated settings (% rows)', n; end if;
  begin insert into public.departments(name) values ('x'); raise exception 'employee inserted department';
  exception when insufficient_privilege or check_violation then null; end;
end $$;
select pg_temp.expect_error($$select public.ceo_save_attendance(null,'10000000-0000-0000-0000-0000000000a1',now(),null,'because')$$, 'Only the CEO');
select pg_temp.expect_error($$select public.auto_clock_out()$$, 'permission denied');
select pg_temp.expect_error($$select public.log_audit('x',null,'y')$$, 'permission denied');

-- settings accessor works for employees
do $$ declare t text; begin
  select timezone into t from public.get_app_settings();
  if t <> 'Asia/Tbilisi' then raise exception 'settings tz %', t; end if;
end $$;

-- clock in: server time, work_date from company tz, IP recorded
do $$ declare r public.attendance; begin
  r := public.clock_in();
  if abs(extract(epoch from (now() - r.clock_in))) > 5 then raise exception 'clock_in not server time'; end if;
  if r.work_date <> (now() at time zone 'Asia/Tbilisi')::date then raise exception 'work_date wrong'; end if;
  if host(r.clock_in_ip) <> '203.0.113.7' then raise exception 'ip %', r.clock_in_ip; end if;
  if r.employee_name <> 'Alice A' then raise exception 'snapshot missing'; end if;
end $$;
select pg_temp.expect_error($$select public.clock_in()$$, 'already clocked in');

-- make the open record older so worked_minutes is non-zero (as superuser), then clock out
reset role;
update public.attendance set clock_in = now() - interval '95 minutes' where employee_name='Alice A';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
do $$ declare r public.attendance; begin
  r := public.clock_out();
  if r.worked_minutes not between 94 and 96 then raise exception 'worked %', r.worked_minutes; end if;
  if r.clockout_type <> 'manual' or r.clock_out_ip is null then raise exception 'clockout fields'; end if;
end $$;
select pg_temp.expect_error($$select public.clock_out()$$, 'not clocked in');

-- ===== Bob must not see Alice =====
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
do $$ begin
  if (select count(*) from public.attendance) <> 1 then raise exception 'bob sees % rows', (select count(*) from public.attendance); end if;
end $$;

-- ===== CEO =====
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
do $$ begin
  if (select count(*) from public.employees) <> 3 then raise exception 'ceo employees'; end if;
  if (select count(*) from public.attendance) <> 2 then raise exception 'ceo attendance'; end if;
end $$;

-- correction requires reason, validates order, audits
select pg_temp.expect_error($$select public.ceo_save_attendance(null,'10000000-0000-0000-0000-0000000000b1','2026-10-02 07:00+00','2026-10-02 15:00+00','')$$, 'reason');
select pg_temp.expect_error($$select public.ceo_save_attendance(null,'10000000-0000-0000-0000-0000000000b1','2026-10-02 15:00+00','2026-10-02 07:00+00','oops')$$, 'before clock-in');
do $$ declare r public.attendance; id0 uuid; begin
  r := public.ceo_save_attendance(null,'10000000-0000-0000-0000-0000000000b1','2026-10-02 07:00+00','2026-10-02 15:30+00','forgot to clock in');
  if r.worked_minutes <> 510 then raise exception 'minutes %', r.worked_minutes; end if;
  if r.work_date <> date '2026-10-02' then raise exception 'wd'; end if;
  r := public.ceo_save_attendance(r.id,'10000000-0000-0000-0000-0000000000b1','2026-10-02 07:00+00','2026-10-02 16:00+00','typo in end time');
  if r.worked_minutes <> 540 then raise exception 'edit minutes'; end if;
  id0 := r.id;
  perform public.ceo_delete_attendance(id0, 'duplicate record');
  if exists (select 1 from public.attendance where id = id0) then raise exception 'not deleted'; end if;
end $$;
select pg_temp.expect_error($$select public.ceo_save_attendance(null,'10000000-0000-0000-0000-0000000000b1','2026-10-01 08:00+00',null,'dup')$$, 'already has a record');
do $$ begin
  if (select count(*) from public.audit_logs where action like 'attendance.%') < 3 then raise exception 'audit rows missing'; end if;
  if (select count(*) from public.audit_logs where action='attendance.update' and metadata ? 'old' and metadata ? 'new' and metadata->>'reason' = 'typo in end time') <> 1 then raise exception 'audit update content'; end if;
end $$;

-- settings: validation + audit + departments
select pg_temp.expect_error($$update public.company_settings set timezone='Mars/Base'$$, 'Unknown time zone');
update public.company_settings set work_end_time='18:00';
insert into public.departments(name) values ('Test Dept');
do $$ begin
  if (select count(*) from public.audit_logs where action='company_settings.update') <> 1 then raise exception 'settings audit'; end if;
  if (select count(*) from public.audit_logs where action='departments.insert' and metadata->'new'->>'name' = 'Test Dept') <> 1 then raise exception 'dept audit'; end if;
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000a1', (select id from public.departments where name='Test Dept'));
end $$;
select pg_temp.expect_error($$insert into public.audit_logs(action) values ('forged')$$, 'permission denied');

-- ===== auto clock-out (as superuser, as cron would) =====
reset role;
update public.company_settings set work_start_time='11:00', work_end_time='23:59';
delete from public.attendance where employee_name='Alice A';
-- (a) open record from 3 days ago: must be closed at 23:59 Tbilisi of that day
insert into public.attendance (employee_id, work_date, clock_in)
values ('10000000-0000-0000-0000-0000000000b1',
        (now() at time zone 'Asia/Tbilisi')::date - 3,
        ((now() at time zone 'Asia/Tbilisi')::date - 3 + time '11:05') at time zone 'Asia/Tbilisi');
-- (b) open record from today, end of day not reached: must stay open
insert into public.attendance (employee_id, work_date, clock_in)
values ('10000000-0000-0000-0000-0000000000a1', (now() at time zone 'Asia/Tbilisi')::date, now() - interval '1 minute');
do $$ declare n int; r public.attendance; begin
  n := public.auto_clock_out();
  if n <> 1 then raise exception 'expected 1 auto close, got %', n; end if;
  select * into r from public.attendance
   where employee_id='10000000-0000-0000-0000-0000000000b1' and work_date=(now() at time zone 'Asia/Tbilisi')::date - 3;
  if r.clockout_type <> 'automatic' then raise exception 'type %', r.clockout_type; end if;
  if r.worked_minutes <> 774 then raise exception 'auto minutes % (want 774 = 11:05..23:59)', r.worked_minutes; end if;
  if (select clock_out from public.attendance where employee_id='10000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'today open record was closed too early'; end if;
  if public.auto_clock_out() <> 0 then raise exception 'not idempotent'; end if;
end $$;

-- overnight shift: 22:00 -> 06:00 ; record from 3 days ago must close at 06:00 the NEXT day
update public.company_settings set work_start_time='22:00', work_end_time='06:00';
insert into public.attendance (employee_id, work_date, clock_in)
values ('10000000-0000-0000-0000-0000000000c1',
        (now() at time zone 'Asia/Tbilisi')::date - 3,
        ((now() at time zone 'Asia/Tbilisi')::date - 3 + time '22:10') at time zone 'Asia/Tbilisi');
do $$ declare r public.attendance; begin
  perform public.auto_clock_out();
  select * into r from public.attendance where employee_id='10000000-0000-0000-0000-0000000000c1';
  if r.worked_minutes <> 470 then raise exception 'overnight minutes % (want 470)', r.worked_minutes; end if;
end $$;

-- safe delete order: removing the auth user first nulls the link, then the employee row can go; history stays
delete from auth.users where id='00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if (select auth_user_id from public.employees where employee_number='EMP003') is not null then raise exception 'link not nulled'; end if;
end $$;
delete from public.employees where employee_number='EMP003';
do $$ begin
  if (select count(*) from public.attendance where employee_name='Bob B' and employee_id is null) < 1 then
    raise exception 'history lost or unattributed after delete'; end if;
end $$;

\echo 'ALL DB TESTS PASSED'
