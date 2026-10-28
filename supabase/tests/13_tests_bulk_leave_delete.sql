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

\echo '--- part 12 checks start (developer deletes several leaves)'
reset role;

\set ceo '''00000000-0000-0000-0000-0000000000c1'''
\set dev '''00000000-0000-0000-0000-0000000000f1'''
\set ba  '''71000000-0000-0000-0000-000000000001'''

insert into public.departments (name) values ('Bulk Lab');
insert into auth.users (id, email) values ('71000000-0000-0000-0000-000000000001','ba@x.test');
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, department_id) values
  ('70000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','BL001','Bea','A','ba@x.test',(select id from public.departments where name='Bulk Lab'));
insert into public.leave_requests (id, employee_id, category, start_date, end_date, status) values
  ('72000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','vacation','2027-02-01','2027-02-02','approved'),
  ('72000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000001','vacation','2027-03-01','2027-03-02','pending'),
  ('72000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000001','day_off','2027-04-05','2027-04-05','approved'),
  ('72000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000001','day_off','2027-05-05','2027-05-05','approved');
delete from public.audit_logs;

-- employee and CEO cannot
select pg_temp.as_user(:ba);
set role authenticated;
select pg_temp.expect_error($$select public.dev_delete_leaves(array['72000000-0000-0000-0000-000000000001']::uuid[])$$, 'Only a developer');
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
select pg_temp.expect_error($$select public.dev_delete_leaves(array['72000000-0000-0000-0000-000000000001']::uuid[])$$, 'Only a developer');
reset role;
do $$ begin if (select count(*) from public.leave_requests where employee_id = '70000000-0000-0000-0000-000000000001') <> 4 then raise exception 'nothing may be deleted by a non-developer'; end if; end $$;

-- developer
select pg_temp.as_user(:dev);
set role authenticated;
select pg_temp.expect_error($$select public.dev_delete_leaves(null)$$, 'at least one');
select pg_temp.expect_error($$select public.dev_delete_leaves('{}'::uuid[])$$, 'at least one');
select pg_temp.expect_error($$select public.dev_delete_leaves((select array_agg(gen_random_uuid()) from generate_series(1, 501)))$$, 'at most 500');
do $$ declare n int; begin
  -- 3 real ids, one repeated, one that does not exist
  n := public.dev_delete_leaves(array[
    '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000003',
    '72000000-0000-0000-0000-000000000003', gen_random_uuid()]::uuid[]);
  if n <> 3 then raise exception 'should delete 3, deleted %', n; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.leave_requests where employee_id = '70000000-0000-0000-0000-000000000001') <> 1 then raise exception 'one leave must remain'; end if;
  if not exists (select 1 from public.leave_requests where id = '72000000-0000-0000-0000-000000000004') then raise exception 'wrong leave remained'; end if;
  if (select count(*) from public.audit_logs where action = 'leave.delete' and employee_id = '70000000-0000-0000-0000-000000000001') <> 3 then raise exception 'one audit entry per deleted leave'; end if;
  if exists (select 1 from public.audit_logs where action = 'leave.delete' and (metadata->>'bulk') is distinct from 'true') then raise exception 'bulk flag'; end if;
end $$;
\echo 'PART 12 DB TESTS PASSED'
