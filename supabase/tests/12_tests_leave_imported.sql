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

\echo '--- part 11 checks start (leave days already used before the app)'
reset role;

\set ceo '''00000000-0000-0000-0000-0000000000c1'''
\set ia  '''61000000-0000-0000-0000-000000000001'''
\set ib  '''61000000-0000-0000-0000-000000000002'''

insert into public.departments (name) values ('Import Lab');
insert into auth.users (id, email) values ('61000000-0000-0000-0000-000000000001','ia@x.test'),('61000000-0000-0000-0000-000000000002','ib@x.test');
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, department_id) values
  ('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','IL001','Ira','A','ia@x.test',(select id from public.departments where name='Import Lab')),
  ('60000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000002','IL002','Ivo','B','ib@x.test',(select id from public.departments where name='Import Lab'));

-- the import: 18 vacation days and 2 days off already used in 2026 (zero rows are not needed)
insert into public.leave_imported_usage (employee_id, year, category, days) values
  ('60000000-0000-0000-0000-000000000001', 2026, 'vacation', 18),
  ('60000000-0000-0000-0000-000000000001', 2026, 'day_off', 2);

-- balances count them, without any leave request existing
select pg_temp.as_user(:ia);
set role authenticated;
do $$ declare b record; begin
  select * into b from public.leave_balance('60000000-0000-0000-0000-000000000001', 2026) where category = 'vacation';
  if b.allowance <> 24 or b.used <> 18 or b.pending <> 0 or b.remaining <> 6 then raise exception 'vacation balance: %', to_jsonb(b); end if;
  select * into b from public.leave_balance('60000000-0000-0000-0000-000000000001', 2026) where category = 'day_off';
  if b.allowance <> 4 or b.used <> 2 or b.remaining <> 2 then raise exception 'day off balance: %', to_jsonb(b); end if;
  select * into b from public.leave_balance('60000000-0000-0000-0000-000000000001', 2026) where category = 'unpaid';
  if b.used <> 0 or b.remaining <> 15 then raise exception 'unpaid balance: %', to_jsonb(b); end if;
  -- another year is untouched
  select * into b from public.leave_balance('60000000-0000-0000-0000-000000000001', 2027) where category = 'vacation';
  if b.used <> 0 or b.remaining <> 24 then raise exception '2027 balance: %', to_jsonb(b); end if;
  -- no calendar entries are invented
  if exists (select 1 from public.leave_requests where employee_id = '60000000-0000-0000-0000-000000000001') then raise exception 'a leave request was invented'; end if;
  if (select count(*) from public.leave_imported_usage) <> 2 then raise exception 'own rows visible'; end if;
end $$;

-- the "not enough days left" check includes them: 7 working days > 6 left, 6 is fine
select pg_temp.expect_error($$select public.request_leave('vacation','2026-11-02','2026-11-10','x','10000000-0000-0000-0000-0000000000c1','60000000-0000-0000-0000-000000000002')$$, 'Not enough days left');
do $$ declare r public.leave_requests; b record; begin
  r := public.request_leave('vacation','2026-11-02','2026-11-09','x','10000000-0000-0000-0000-0000000000c1','60000000-0000-0000-0000-000000000002');
  select * into b from public.leave_balance('60000000-0000-0000-0000-000000000001', 2026) where category = 'vacation';
  if b.used <> 18 or b.pending <> 6 or b.remaining <> 0 then raise exception 'after request: %', to_jsonb(b); end if;
end $$;

-- nobody can write the table from the app
select pg_temp.expect_error($$insert into public.leave_imported_usage (employee_id, year, category, days) values ('60000000-0000-0000-0000-000000000001', 2026, 'unpaid', 1)$$, 'permission denied');
select pg_temp.expect_error($$update public.leave_imported_usage set days = 0$$, 'permission denied');
reset role;

-- a colleague cannot read someone else's imported usage, the CEO can
select pg_temp.as_user(:ib);
set role authenticated;
do $$ begin
  if (select count(*) from public.leave_imported_usage) <> 0 then raise exception 'colleague sees imported usage'; end if;
end $$;
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ declare b record; begin
  if (select count(*) from public.leave_imported_usage) <> 2 then raise exception 'CEO should see the imported usage'; end if;
  select * into b from public.leave_balances_all(2026) where employee_id = '60000000-0000-0000-0000-000000000001' and category = 'vacation';
  if b.used <> 18 then raise exception 'analytics ignores imported usage: %', to_jsonb(b); end if;
end $$;
reset role;

-- deleting the person removes their rows
delete from public.leave_requests where employee_id = '60000000-0000-0000-0000-000000000001';
delete from public.employees where id = '60000000-0000-0000-0000-000000000001';
do $$ begin if exists (select 1 from public.leave_imported_usage) then raise exception 'cascade'; end if; end $$;
\echo 'PART 11 DB TESTS PASSED'
