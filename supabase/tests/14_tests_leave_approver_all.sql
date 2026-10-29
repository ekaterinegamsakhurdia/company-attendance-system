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

\echo '--- part 13 checks start (head of a company-wide approving department)'
reset role;

\set ceo  '''00000000-0000-0000-0000-0000000000c1'''
\set dev  '''00000000-0000-0000-0000-0000000000f1'''
\set mia  '''81000000-0000-0000-0000-000000000001'''
\set pat  '''81000000-0000-0000-0000-000000000002'''
\set quinn '''81000000-0000-0000-0000-000000000003'''
\set ned  '''81000000-0000-0000-0000-000000000004'''

-- AM Lab approves company-wide (Mia heads it), Prod Lab is an ordinary department (Pat heads it, Quinn and Ned work there)
insert into public.departments (name, approves_all_leaves) values ('AM Lab', true), ('Prod Lab', false);
insert into auth.users (id, email) values
  ('81000000-0000-0000-0000-000000000001','mia@x.test'),('81000000-0000-0000-0000-000000000002','pat@x.test'),
  ('81000000-0000-0000-0000-000000000003','quinn@x.test'),('81000000-0000-0000-0000-000000000004','ned@x.test');
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, department_id) values
  ('80000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','AL001','Mia','Head','mia@x.test',(select id from public.departments where name='AM Lab')),
  ('80000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000002','PL001','Pat','Head','pat@x.test',(select id from public.departments where name='Prod Lab')),
  ('80000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000003','PL002','Quinn','Q','quinn@x.test',(select id from public.departments where name='Prod Lab')),
  ('80000000-0000-0000-0000-000000000004','81000000-0000-0000-0000-000000000004','PL003','Ned','N','ned@x.test',(select id from public.departments where name='Prod Lab'));
update public.departments set head_employee_id = '80000000-0000-0000-0000-000000000001' where name = 'AM Lab';
update public.departments set head_employee_id = '80000000-0000-0000-0000-000000000002' where name = 'Prod Lab';
delete from public.audit_logs;

-- the default flag: the seeded "Account Managers" department is marked, the others are not
do $$ begin
  if not (select approves_all_leaves from public.departments where lower(name) = 'account managers') then raise exception 'Account Managers must be marked'; end if;
  if (select approves_all_leaves from public.departments where name = 'Prod Lab') then raise exception 'Prod Lab must not be marked'; end if;
end $$;

-- ===== the form offers Mia to a person of another department, but not to herself or to CEOs =====
select pg_temp.as_user(:quinn);
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();
  if not exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'id' = '80000000-0000-0000-0000-000000000001' and a->>'kind' = 'AM Lab head') then raise exception 'Mia is not offered: %', o; end if;
  if not exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'id' = '80000000-0000-0000-0000-000000000002' and a->>'kind' = 'Department head') then raise exception 'own head missing'; end if;
  if (select count(*) from jsonb_array_elements(o->'approvers') a where a->>'id' = '80000000-0000-0000-0000-000000000001') <> 1 then raise exception 'Mia listed twice'; end if;
end $$;
reset role;
select pg_temp.as_user(:mia);
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();
  if exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'id' = '80000000-0000-0000-0000-000000000001') then raise exception 'Mia offered to herself'; end if;
  if not exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'kind' = 'CEO') then raise exception 'Mia needs a CEO'; end if;
end $$;
reset role;
-- a CEO still only gets CEOs / developers
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();
  if exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'id' = '80000000-0000-0000-0000-000000000001') then raise exception 'a CEO must not pick Mia'; end if;
end $$;
reset role;

-- ===== requests: Quinn (employee) and Pat (another head) choose Mia =====
select pg_temp.as_user(:quinn);
set role authenticated;
do $$ begin
  perform public.request_leave('vacation', '2027-02-01', '2027-02-02', null, '80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000004');
end $$;
reset role;
select pg_temp.as_user(:pat);
set role authenticated;
do $$ begin
  perform public.request_leave('day_off', '2027-02-10', '2027-02-10', null, '80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000003');
end $$;
reset role;
-- an ordinary head is still not a valid approver for people of other departments
select pg_temp.as_user('81000000-0000-0000-0000-000000000004');
set role authenticated;
do $$ begin perform public.request_leave('vacation', '2027-03-01', '2027-03-01', null, '80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000003'); end $$;
reset role;
select pg_temp.as_user(:mia);
set role authenticated;
-- Mia needs someone other than herself or a plain employee
select pg_temp.expect_error($$select public.request_leave('vacation', '2027-03-09', '2027-03-09', null, '80000000-0000-0000-0000-000000000003')$$, 'approved by');
select pg_temp.expect_error($$select public.request_leave('vacation', '2027-03-09', '2027-03-09', null, '80000000-0000-0000-0000-000000000001')$$, 'someone else');
reset role;

-- ===== what Mia sees and does =====
select pg_temp.as_user(:mia);
set role authenticated;
do $$ declare n int; begin
  -- earlier test files left other employees' leaves in the database: she sees them too (they are employees)
  select count(*) into n from public.list_leaves('managed');
  if n < 3 then raise exception 'Mia should see the leaves of other departments, saw %', n; end if;
  if (select count(*) from public.list_leaves('managed', null, null, null, null) l join public.employees e on e.id = l.employee_id where e.role <> 'employee') <> 0 then raise exception 'Mia sees leaves of CEOs / developers'; end if;
  if (select count(*) from public.list_leaves('managed') where employee_name in ('Quinn Q','Pat Head','Ned N')) <> 3 then raise exception 'names'; end if;
  -- the employee list: employees yes, CEOs and developers no
  if (select count(*) from public.employees where role = 'employee') < 4 then raise exception 'Mia must see the employees'; end if;
  if exists (select 1 from public.employees where role in ('ceo','developer')) then raise exception 'Mia must not see CEOs / developers'; end if;
  if (select count(*) from public.leave_requests where employee_id in ('80000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000003')) <> 2 then raise exception 'direct select on leaves'; end if;
  if (select count(*) from public.leave_balance('80000000-0000-0000-0000-000000000003', 2027)) <> 3 then raise exception 'balance'; end if;
  if (select count(distinct employee_id) from public.leave_balances_all(2027)) < 4 then raise exception 'balances for everybody'; end if;
  if exists (select 1 from public.leave_balances_all(2027) b join public.employees e on e.id = b.employee_id where e.role in ('ceo','developer')) then raise exception 'balances of CEOs'; end if;
end $$;
-- approve Quinn's, reject Pat's
do $$ declare l uuid; begin
  select id into l from public.list_leaves('managed') where employee_name = 'Quinn Q';
  if (select status from public.decide_leave(l, 'approved', 'enjoy')) <> 'approved' then raise exception 'approve'; end if;
  select id into l from public.list_leaves('managed') where employee_name = 'Pat Head';
  if (select status from public.decide_leave(l, 'rejected', 'busy week')) <> 'rejected' then raise exception 'reject'; end if;
end $$;
-- cancel an approved future leave with a reason
do $$ declare l uuid; begin
  select id into l from public.list_leaves('managed') where employee_name = 'Quinn Q';
  perform pg_temp.expect_error(format($q$select public.cancel_leave(%L, '')$q$, l), 'reason');
  if (select status from public.cancel_leave(l, 'plans changed')) <> 'cancelled' then raise exception 'cancel'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.audit_logs where action in ('leave.approve','leave.reject','leave.cancel') and actor_user_id = '81000000-0000-0000-0000-000000000001') <> 3 then raise exception 'audit rows by Mia'; end if;
end $$;

-- ===== limits =====
-- a CEO's leave is out of Mia's reach; so is her own
insert into public.leave_requests (id, employee_id, category, start_date, end_date, status)
  values ('82000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000c1','vacation','2027-04-05','2027-04-06','pending'),
         ('82000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000001','vacation','2027-04-12','2027-04-13','pending'),
         ('82000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-0000000000f1','vacation','2027-04-19','2027-04-20','pending');
select pg_temp.as_user(:mia);
set role authenticated;
select pg_temp.expect_error($$select public.decide_leave('82000000-0000-0000-0000-000000000001', 'approved')$$, 'Only a CEO');
select pg_temp.expect_error($$select public.decide_leave('82000000-0000-0000-0000-000000000003', 'approved')$$, 'Only a CEO');
select pg_temp.expect_error($$select public.decide_leave('82000000-0000-0000-0000-000000000002', 'approved')$$, 'your own');
do $$ begin
  if exists (select 1 from public.list_leaves('managed') where employee_id in ('10000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-0000000000f1')) then raise exception 'CEO / developer leaves visible'; end if;
  if exists (select 1 from public.leave_requests where id in ('82000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000003')) then raise exception 'CEO / developer leaves visible by select'; end if;
end $$;
select pg_temp.expect_error($$select * from public.leave_balance('10000000-0000-0000-0000-0000000000c1', 2027)$$, 'cannot see');
reset role;
-- an ordinary head sees only their own department; a plain employee sees only their own leaves
select pg_temp.as_user(:pat);
set role authenticated;
do $$ begin
  if exists (select 1 from public.list_leaves('managed') where employee_name = 'Mia Head') then raise exception 'Pat sees Mia'; end if;
  if (select count(*) from public.employees where department_id = (select id from public.departments where name = 'AM Lab')) <> 0 then raise exception 'Pat sees the AM Lab people'; end if;
  perform pg_temp.expect_error($e$select public.decide_leave('82000000-0000-0000-0000-000000000002', 'approved')$e$, 'Only a CEO');
end $$;
reset role;
select pg_temp.as_user(:ned);
set role authenticated;
do $$ begin
  if (select count(*) from public.leave_requests where employee_id <> '80000000-0000-0000-0000-000000000004') <> 0 then raise exception 'a plain employee sees others'' leaves'; end if;
  perform pg_temp.expect_error($e$select * from public.list_leaves('managed')$e$, 'Only a CEO');
  perform pg_temp.expect_error($e$select public.decide_leave('82000000-0000-0000-0000-000000000002', 'approved')$e$, 'Only a CEO');
end $$;
reset role;

-- ===== the mark is the switch: only a CEO / developer sets it, and it takes effect and ends at once =====
select pg_temp.as_user(:mia);
set role authenticated;
do $$ declare n int; begin
  update public.departments set approves_all_leaves = false where name = 'AM Lab'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'a head changed the mark'; end if;
end $$;
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
update public.departments set approves_all_leaves = false where name = 'AM Lab';
reset role;
select pg_temp.as_user(:mia);
set role authenticated;
do $$ begin
  -- she is still the head of her own department, nothing more
  if exists (select 1 from public.list_leaves('managed') where employee_name in ('Quinn Q','Pat Head','Ned N')) then raise exception 'Mia still sees other departments'' leaves'; end if;
  perform pg_temp.expect_error($e$select public.decide_leave('82000000-0000-0000-0000-000000000002', 'approved')$e$, 'your own');
  if exists (select 1 from public.employees where department_id = (select id from public.departments where name = 'Prod Lab')) then raise exception 'Mia still sees the employees'; end if;
end $$;
reset role;
select pg_temp.as_user(:quinn);
set role authenticated;
do $$ begin
  if exists (select 1 from jsonb_array_elements(public.leave_form_options()->'approvers') a where a->>'id' = '80000000-0000-0000-0000-000000000001') then raise exception 'Mia still offered'; end if;
  perform pg_temp.expect_error($e$select public.request_leave('vacation', '2027-05-04', '2027-05-04', null, '80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000004')$e$, 'approved by');
end $$;
reset role;
-- an inactive department does not count either
update public.departments set approves_all_leaves = true, is_active = false where name = 'AM Lab';
do $$ begin if public.is_org_leave_approver('80000000-0000-0000-0000-000000000001') then raise exception 'inactive department approves'; end if; end $$;
update public.departments set is_active = true where name = 'AM Lab';
do $$ begin if not public.is_org_leave_approver('80000000-0000-0000-0000-000000000001') then raise exception 'active department does not approve'; end if; end $$;

\echo 'PART 13 DB TESTS PASSED'
