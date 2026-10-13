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
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.headers', '{"x-forwarded-for":"198.51.100.1"}', false);
end $$;

\echo '--- part 6 checks start (profile card details)'
reset role;
update public.company_settings set require_biometric = false, require_company_network = false;

\set ceo '''00000000-0000-0000-0000-0000000000c1'''
\set dev '''00000000-0000-0000-0000-0000000000f1'''
\set pa  '''33000000-0000-0000-0000-000000000002'''
\set ph  '''33000000-0000-0000-0000-000000000001'''

insert into public.departments (name) values ('Card Lab'), ('Other Lab');
insert into auth.users (id, email) values
  ('33000000-0000-0000-0000-000000000001','card.head@x.test'),('33000000-0000-0000-0000-000000000002','card.a@x.test'),
  ('33000000-0000-0000-0000-000000000003','card.b@x.test'),('33000000-0000-0000-0000-000000000004','other.head@x.test'),
  ('33000000-0000-0000-0000-0000000000c3','card.ceo@x.test');
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, department_id, role) values
  ('34000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','CL001','Card','Head','card.head@x.test',(select id from public.departments where name='Card Lab'),'employee'),
  ('34000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','CL002','Card','A','card.a@x.test',(select id from public.departments where name='Card Lab'),'employee'),
  ('34000000-0000-0000-0000-000000000003','33000000-0000-0000-0000-000000000003','CL003','Card','B','card.b@x.test',(select id from public.departments where name='Card Lab'),'employee'),
  ('34000000-0000-0000-0000-000000000004','33000000-0000-0000-0000-000000000004','OL001','Other','Head','other.head@x.test',(select id from public.departments where name='Other Lab'),'employee'),
  ('34000000-0000-0000-0000-0000000000c3','33000000-0000-0000-0000-0000000000c3','CC003','Card','Chief','card.ceo@x.test',null,'ceo');
update public.departments set head_employee_id = '34000000-0000-0000-0000-000000000001' where name = 'Card Lab';
update public.departments set head_employee_id = '34000000-0000-0000-0000-000000000004' where name = 'Other Lab';

-- ===== A. a CEO saves every field; values are normalised and validated =====
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ declare p public.employee_profiles; begin
  perform public.set_employee_profile('34000000-0000-0000-0000-000000000002', '1995-05-17', '2025-02-17', '  Tbilisi HQ ', 'Georgia', 7, '34000000-0000-0000-0000-000000000001');
  select * into p from public.employee_profiles where employee_id = '34000000-0000-0000-0000-000000000002';
  if p.office <> 'Tbilisi HQ' or p.country <> 'Georgia' or p.daily_hours <> 7 or p.birth_date <> '1995-05-17' or p.hire_date <> '2025-02-17'
     or p.approver_id <> '34000000-0000-0000-0000-000000000001' then raise exception 'profile not saved as given: %', to_jsonb(p); end if;
end $$;
do $$ declare p public.employee_profiles; begin
  perform public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, '  ', '', null, null);
  select * into p from public.employee_profiles where employee_id = '34000000-0000-0000-0000-000000000002';
  if p.office is not null or p.country is not null or p.daily_hours is not null or p.approver_id is not null then raise exception 'blank values not cleared'; end if;
  perform public.set_employee_profile('34000000-0000-0000-0000-000000000002', '1995-05-17', '2025-02-17', 'Tbilisi HQ', 'Georgia', 7.5, '34000000-0000-0000-0000-0000000000c3');
end $$;

select pg_temp.expect_error($$select public.set_employee_profile('34000000-0000-0000-0000-000000000002', '2999-01-01', null, null, null, null, null)$$, 'Birth date');
select pg_temp.expect_error($$select public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, '1900-01-01', null, null, null, null)$$, 'Start date');
select pg_temp.expect_error($$select public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, null, null, 0, null)$$, 'between 0 and 24');
select pg_temp.expect_error($$select public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, null, null, 25, null)$$, 'between 0 and 24');
select pg_temp.expect_error($$select public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, repeat('x', 101), null, null, null)$$, 'too long');
select pg_temp.expect_error($$select public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, null, null, null, '34000000-0000-0000-0000-000000000002')$$, 'another active person');
select pg_temp.expect_error($$select public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, null, null, null, '34000000-0000-0000-0000-000000000004')$$, 'approver must be');   -- head of another department
select pg_temp.expect_error($$select public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, null, null, null, '34000000-0000-0000-0000-000000000003')$$, 'approver must be');   -- a colleague
select pg_temp.expect_error($$select public.set_employee_profile('10000000-0000-0000-0000-0000000000f1', null, null, null, null, null, null)$$, 'Only a developer');   -- a CEO cannot edit the developer
reset role;

-- ===== B. an employee, a head and a plain colleague cannot write or read others =====
select pg_temp.as_user(:pa);
set role authenticated;
select pg_temp.expect_error($$select public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, 'Home', null, null, null)$$, 'Only a CEO or developer');
do $$ begin
  if (select count(*) from public.employee_profiles) <> 1 then raise exception 'an employee sees other people''s profiles'; end if;
  if not exists (select 1 from public.employee_profiles where employee_id = '34000000-0000-0000-0000-000000000002') then raise exception 'cannot read own profile'; end if;
end $$;
reset role;
select pg_temp.as_user(:ph);
set role authenticated;
do $$ begin
  if exists (select 1 from public.employee_profiles) then raise exception 'a department head can read profiles'; end if;
  begin perform public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, 'x', null, null, null); raise exception 'head edited a profile'; exception when sqlstate '42501' then null; end;
end $$;
reset role;

-- ===== C. the developer edits anything, including CEO accounts and the approver of a CEO =====
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  perform public.set_employee_profile('34000000-0000-0000-0000-0000000000c3', '1980-01-01', '2020-01-01', 'HQ', 'Georgia', 8, '10000000-0000-0000-0000-0000000000c1');
  perform public.set_employee_profile('34000000-0000-0000-0000-000000000003', null, '2024-03-01', null, null, null, '34000000-0000-0000-0000-000000000001');
  -- a CEO's approver must be a CEO / developer, never a department head
  begin perform public.set_employee_profile('34000000-0000-0000-0000-0000000000c3', null, null, null, null, null, '34000000-0000-0000-0000-000000000001'); raise exception 'head accepted as CEO approver'; exception when sqlstate '22023' then null; end;
end $$;
reset role;
-- the CEO may edit their own details
select pg_temp.as_user('33000000-0000-0000-0000-0000000000c3');
set role authenticated;
do $$ begin perform public.set_employee_profile('34000000-0000-0000-0000-0000000000c3', '1980-01-01', '2020-01-01', 'Home', 'Georgia', 6, null); end $$;
reset role;

-- ===== D. leave form: the usual approver is pre-selected when allowed =====
select pg_temp.as_user(:pa);
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();
  if (o ->> 'default_approver_id') is distinct from '34000000-0000-0000-0000-0000000000c3' then raise exception 'default approver not offered: %', o; end if;
end $$;
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin perform public.set_employee_profile('34000000-0000-0000-0000-000000000002', null, null, null, null, null, null); end $$;
reset role;
select pg_temp.as_user(:pa);
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();
  if (o ->> 'default_approver_id') is not null then raise exception 'default approver should be empty: %', o; end if;
end $$;
reset role;
-- an approver who stops being allowed is just not pre-selected: remove the head's headship
update public.departments set head_employee_id = null where name = 'Card Lab';
select pg_temp.as_user('33000000-0000-0000-0000-000000000003');
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();     -- Card B had the head as approver in section C
  if (o ->> 'default_approver_id') is not null then raise exception 'ex-head still pre-selected: %', o; end if;
end $$;
reset role;
update public.departments set head_employee_id = '34000000-0000-0000-0000-000000000001' where name = 'Card Lab';

-- ===== E. list_leaves for one person =====
select pg_temp.as_user(:dev);
set role authenticated;
do $$ declare rid uuid; n int; begin
  perform public.dev_save_leave(null, '34000000-0000-0000-0000-000000000002', 'vacation', '2031-03-04', '2031-03-05', null, null, null, 'approved', null);
  perform public.dev_save_leave(null, '34000000-0000-0000-0000-000000000003', 'unpaid', '2031-03-04', '2031-03-04', null, null, null, 'pending', null);
  select count(*) into n from public.list_leaves('managed', '2031-01-01', '2031-12-31');
  if n <> 2 then raise exception 'all: %', n; end if;
  select count(*) into n from public.list_leaves('managed', '2031-01-01', '2031-12-31', null, '34000000-0000-0000-0000-000000000002');
  if n <> 1 then raise exception 'one person: %', n; end if;
  select count(*) into n from public.list_leaves('managed', null, null, 'pending', '34000000-0000-0000-0000-000000000002');
  if n <> 0 then raise exception 'person + status: %', n; end if;
end $$;
reset role;
select pg_temp.as_user('33000000-0000-0000-0000-000000000004');       -- another department's head cannot list this person
set role authenticated;
do $$ begin
  if exists (select 1 from public.list_leaves('managed', '2031-01-01', '2031-12-31', null, '34000000-0000-0000-0000-000000000002')) then raise exception 'foreign head sees the person'; end if;
end $$;
reset role;

-- ===== F. audit + cleanup rules =====
do $$ begin
  if not exists (select 1 from public.audit_logs where action = 'employee.profile' and metadata ? 'new') then raise exception 'no employee.profile audit row'; end if;
end $$;
-- approver deleted -> the field is cleared, nobody is blocked
update public.employee_profiles set approver_id = '34000000-0000-0000-0000-0000000000c3' where employee_id = '34000000-0000-0000-0000-000000000002';
delete from public.employees where id = '34000000-0000-0000-0000-0000000000c3';
do $$ begin
  if (select approver_id from public.employee_profiles where employee_id = '34000000-0000-0000-0000-000000000002') is not null then raise exception 'dangling approver'; end if;
end $$;

\echo 'PART 6 DB TESTS PASSED'
