\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.expect_error(q text, needle text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm ilike '%' || needle || '%' or sqlstate = needle then return; end if;
    raise exception 'wrong error for [%]: got "%" (%), wanted "%"', q, sqlerrm, sqlstate, needle;
  end;
  raise exception 'expected error containing "%" but succeeded: %', needle, q;
end $$;
grant execute on function pg_temp.expect_error(text,text) to public;
create or replace function pg_temp.as_user(uid text, ip text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.headers',
    case when ip is null then '{"x-forwarded-for":"198.51.100.1"}'
         else json_build_object('cf-connecting-ip', ip, 'x-forwarded-for', '198.51.100.1')::text end, false);
end $$;

\echo '--- part 4 checks start (CEO + developer attendance, unlimited networks)'
reset role;
update public.company_settings set require_biometric = false, require_company_network = false;

\set ceo   '''00000000-0000-0000-0000-0000000000c1'''
\set ceo2  '''00000000-0000-0000-0000-0000000000c2'''
\set dev   '''00000000-0000-0000-0000-0000000000f1'''
\set alice '''00000000-0000-0000-0000-0000000000a1'''
\set eve   '''00000000-0000-0000-0000-0000000000e1'''

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c2', 'ceo2@x.test');
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, role)
values ('10000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'CEO2', 'Second', 'Chief', 'ceo2@x.test', 'ceo');

-- ===== A. a CEO and a developer can clock in and out =====
select pg_temp.as_user(:ceo2, '203.0.113.5');
set role authenticated;
do $$ declare r public.attendance; begin
  r := public.clock_in();
  if r.employee_id <> '10000000-0000-0000-0000-0000000000c2' then raise exception 'ceo clock-in row'; end if;
  r := public.clock_out();
  if r.clock_out is null or r.worked_minutes is null then raise exception 'ceo clock-out'; end if;
end $$;
reset role;

select pg_temp.as_user(:dev, '203.0.113.5');
set role authenticated;
do $$ declare r public.attendance; begin
  r := public.clock_in();
  if r.employee_id <> '10000000-0000-0000-0000-0000000000f1' then raise exception 'developer clock-in row'; end if;
end $$;
select pg_temp.expect_error($$select public.clock_in()$$, 'already clocked in');
reset role;

-- ===== B. who can see those records =====
select pg_temp.as_user(:ceo);                       -- another CEO sees everyone, the developer included
set role authenticated;
do $$ begin
  if not exists (select 1 from public.attendance where employee_id = '10000000-0000-0000-0000-0000000000c2') then
    raise exception 'CEO cannot see another CEO''s attendance'; end if;
  if not exists (select 1 from public.attendance where employee_id = '10000000-0000-0000-0000-0000000000f1') then
    raise exception 'CEO cannot see the developer''s attendance'; end if;
end $$;
reset role;

do $$ begin
  -- the CEO's view is the whole table
  perform set_config('test.total', (select count(*)::text from public.attendance), false);
end $$;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if (select count(*) from public.attendance)::text <> current_setting('test.total') then raise exception 'CEO does not see all attendance rows'; end if;
end $$;
reset role;

select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  if (select count(*) from public.attendance)::text <> current_setting('test.total') then raise exception 'developer does not see all attendance rows'; end if;
end $$;
reset role;

select pg_temp.as_user(:alice);                     -- a department head sees neither CEO nor developer
set role authenticated;
do $$ begin
  if exists (select 1 from public.attendance a join public.employees e on e.id = a.employee_id where e.role in ('ceo','developer')) then raise exception 'head can see CEO/developer attendance'; end if;
  if exists (select 1 from public.employees where role = 'developer') then raise exception 'head can see the developer account'; end if;
end $$;
reset role;

select pg_temp.as_user(:eve);                       -- a plain employee sees only herself
set role authenticated;
do $$ begin
  if exists (select 1 from public.attendance where employee_id <> '10000000-0000-0000-0000-0000000000e1') then raise exception 'employee sees others'; end if;
end $$;
reset role;

-- ===== C. corrections: CEOs may correct CEOs, but a developer's records are read-only for them =====
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ declare ceo2_row uuid; begin
  select id into ceo2_row from public.attendance where employee_id = '10000000-0000-0000-0000-0000000000c2';
  perform public.ceo_save_attendance(ceo2_row, null, now() - interval '9 hours', now() - interval '1 hour', 'Fixed by the other CEO');
  if (select count(*) from public.audit_logs where action = 'attendance.update' and description like '%Fixed by the other CEO%') <> 1 then raise exception 'ceo correction audit'; end if;
end $$;
select pg_temp.expect_error(
  $$select public.ceo_save_attendance(null, '10000000-0000-0000-0000-0000000000f1', now() - interval '3 days', now() - interval '3 days' + interval '8 hours', 'Add record for developer')$$,
  'Only a developer can change');
reset role;
do $$ begin
  perform set_config('test.dev_row', (select id::text from public.attendance where employee_id = '10000000-0000-0000-0000-0000000000f1'), false);
end $$;
select pg_temp.as_user(:ceo);
set role authenticated;
select pg_temp.expect_error(
  format($q$select public.ceo_save_attendance(%L, null, now() - interval '8 hours', null, 'Change developer record')$q$, current_setting('test.dev_row')),
  'Only a developer can change');
select pg_temp.expect_error(
  format($q$select public.ceo_delete_attendance(%L, 'Delete developer record')$q$, current_setting('test.dev_row')),
  'Only a developer can change');
reset role;
do $$ begin
  if not exists (select 1 from public.attendance where id = current_setting('test.dev_row')::uuid) then raise exception 'developer record was deleted by a CEO'; end if;
end $$;

-- the developer can correct and add records for developers, CEOs and employees
select pg_temp.as_user(:dev);
set role authenticated;
do $$ declare dev_row uuid := current_setting('test.dev_row')::uuid; begin
  perform public.ceo_save_attendance(dev_row, null, now() - interval '8 hours', null, 'Developer corrects own time');
  perform public.ceo_save_attendance(null, '10000000-0000-0000-0000-0000000000f1', now() - interval '4 days', now() - interval '4 days' + interval '8 hours', 'Add a missing day');
  perform public.ceo_save_attendance(null, '10000000-0000-0000-0000-0000000000c2', now() - interval '5 days', now() - interval '5 days' + interval '8 hours', 'Add a missing CEO day');
  perform public.ceo_delete_attendance((select id from public.attendance where employee_id = '10000000-0000-0000-0000-0000000000f1' and work_date < current_date - 2 limit 1), 'Remove test day');
end $$;
reset role;

-- ===== D. auto clock-out closes forgotten CEO / developer shifts too =====
update public.attendance
   set work_date = work_date - 3, clock_in = clock_in - interval '3 days'
 where employee_id = '10000000-0000-0000-0000-0000000000f1' and clock_out is null;
do $$ declare n int; begin
  n := public.auto_clock_out();
  if n < 1 then raise exception 'auto clock-out closed nothing'; end if;
  if not exists (select 1 from public.attendance where employee_id = '10000000-0000-0000-0000-0000000000f1'
                   and clock_out is not null and clockout_type = 'automatic') then
    raise exception 'developer shift was not closed automatically'; end if;
end $$;

-- ===== E. devices: a CEO can see them but cannot remove a developer's =====
insert into public.webauthn_credentials (id, employee_id, credential_id, public_key, device_name)
values ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'cred-dev', 'pk', 'Dev phone'),
       ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'cred-ceo2', 'pk', 'CEO2 phone');
select pg_temp.as_user(:ceo);
set role authenticated;
select pg_temp.expect_error($$select public.remove_webauthn_credential('20000000-0000-0000-0000-0000000000f1')$$, 'Only a developer can remove');
do $$ begin perform public.remove_webauthn_credential('20000000-0000-0000-0000-0000000000c2'); end $$;   -- another CEO's is fine
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin perform public.remove_webauthn_credential('20000000-0000-0000-0000-0000000000f1'); end $$;
reset role;

-- ===== F. company networks: no limit =====
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  insert into public.allowed_networks (label, network)
  select 'Branch ' || i, ('10.50.' || (i / 250) || '.' || (i % 250) || '/32')::cidr
  from generate_series(1, 300) i;
  if (select count(*) from public.allowed_networks where label like 'Branch %') <> 300 then raise exception '300 networks not stored'; end if;
  -- ranges and IPv6 work next to single addresses
  insert into public.allowed_networks (label, network) values ('Annex range', '10.60.0.0/24'), ('Home office v6', '2001:db8:abcd:12::/64');
end $$;
reset role;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000bc', 'net.tester@x.test');
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, department_id)
values ('10000000-0000-0000-0000-0000000000bc', '00000000-0000-0000-0000-0000000000bc', 'NET1', 'Net', 'Tester', 'net.tester@x.test',
        (select id from public.departments where name = 'Design'));
update public.company_settings set require_company_network = true;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000bc', '10.51.0.1');       -- not listed
set role authenticated;
select pg_temp.expect_error($$select public.clock_in()$$, 'company wifi');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000bc', '10.50.1.49');      -- the 300th entry
set role authenticated;
do $$ begin perform public.clock_in(); end $$;
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000bd', 'net.tester2@x.test');
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, role)
values ('10000000-0000-0000-0000-0000000000bd', '00000000-0000-0000-0000-0000000000bd', 'NET2', 'Net', 'Two', 'net.tester2@x.test', 'ceo');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000bd', '10.60.0.77');       -- a CEO, inside the /24 range
set role authenticated;
do $$ begin perform public.clock_in(); end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000bd', '2001:db8:abcd:12::99');   -- same CEO, IPv6 prefix
set role authenticated;
do $$ begin perform public.clock_out(); end $$;
reset role;

update public.company_settings set require_company_network = false;
delete from public.allowed_networks where label like 'Branch %' or label in ('Annex range', 'Home office v6');

-- leave no extra CEOs behind (run.sh later checks the "only CEO" protection)
delete from public.employees where id in ('10000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000bd');

\echo 'PART 4 DB TESTS PASSED'
