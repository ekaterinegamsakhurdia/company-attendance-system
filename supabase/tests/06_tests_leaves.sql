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

\echo '--- part 5 checks start (leaves, holidays, profile dates)'
reset role;

\set ceo   '''00000000-0000-0000-0000-0000000000c1'''
\set dev   '''00000000-0000-0000-0000-0000000000f1'''
\set alice '''00000000-0000-0000-0000-0000000000a1'''
\set lhead '''31000000-0000-0000-0000-000000000001'''
\set ann   '''31000000-0000-0000-0000-000000000002'''
\set bob   '''31000000-0000-0000-0000-000000000003'''
\set cat   '''31000000-0000-0000-0000-000000000004'''
\set sol   '''31000000-0000-0000-0000-000000000005'''

-- ===== fixtures: a department with a head and three people, and a one-person department =====
insert into public.departments (name) values ('Leave Lab'), ('Solo Lab');
insert into auth.users (id, email) values
  ('31000000-0000-0000-0000-000000000001','hanna@x.test'),('31000000-0000-0000-0000-000000000002','ann@x.test'),
  ('31000000-0000-0000-0000-000000000003','bob@x.test'),('31000000-0000-0000-0000-000000000004','cat@x.test'),
  ('31000000-0000-0000-0000-000000000005','sol@x.test');
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, department_id) values
  ('30000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','LL001','Hanna','Head','hanna@x.test',(select id from public.departments where name='Leave Lab')),
  ('30000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000002','LL002','Ann','A','ann@x.test',(select id from public.departments where name='Leave Lab')),
  ('30000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000003','LL003','Bob','B','bob@x.test',(select id from public.departments where name='Leave Lab')),
  ('30000000-0000-0000-0000-000000000004','31000000-0000-0000-0000-000000000004','LL004','Cat','C','cat@x.test',(select id from public.departments where name='Leave Lab')),
  ('30000000-0000-0000-0000-000000000005','31000000-0000-0000-0000-000000000005','LL005','Sol','S','sol@x.test',(select id from public.departments where name='Solo Lab'));
update public.departments set head_employee_id = '30000000-0000-0000-0000-000000000001' where name = 'Leave Lab';

-- ===== A. holidays: Orthodox Easter is computed, Georgian list is seeded =====
do $$ declare t record; begin
  for t in select * from (values (2025,'2025-04-20'),(2026,'2026-04-12'),(2027,'2027-05-02'),(2028,'2028-04-16'),(2029,'2029-04-08'),(2030,'2030-04-28'),(2035,'2035-04-29')) v(y,d) loop
    if public.orthodox_easter(t.y) <> t.d::date then raise exception 'Easter % is %, expected %', t.y, public.orthodox_easter(t.y), t.d; end if;
  end loop;
  begin perform public.orthodox_easter(1850); raise exception 'year out of range accepted'; exception when sqlstate '22023' then null; end;

  if (select count(*) from public.public_holidays where holiday_date between '2026-01-01' and '2026-12-31') <> 17 then raise exception 'expected 17 holidays in 2026'; end if;
  if (select count(*) from public.public_holidays where holiday_date between '2025-01-01' and '2040-12-31') <> 16*17 then raise exception 'seed range'; end if;
  foreach t.y in array array[2026] loop null; end loop;
  if not exists (select 1 from public.public_holidays where holiday_date = '2026-04-10' and name = 'Orthodox Good Friday') then raise exception 'Good Friday 2026'; end if;
  if not exists (select 1 from public.public_holidays where holiday_date = '2026-04-13' and name = 'Orthodox Easter Monday') then raise exception 'Easter Monday 2026'; end if;
  -- 2029: Easter Monday falls on 9 April together with National Unity Day: both are kept
  if (select count(*) from public.public_holidays where holiday_date = '2029-04-09') <> 2 then raise exception 'coinciding holidays'; end if;
  -- 2027-03-03 is Mother's Day on a Wednesday
  if public.leave_working_days('2027-03-01', '2027-03-05') <> 4 then raise exception 'holiday not excluded'; end if;
  if public.leave_working_days('2027-03-06', '2027-03-07') <> 0 then raise exception 'weekend counted'; end if;
  if public.leave_working_days('2026-04-06', '2026-04-17') <> 7 then raise exception 'Easter week count: %', public.leave_working_days('2026-04-06', '2026-04-17'); end if;
end $$;

select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if public.add_georgian_holidays(2041) <> 17 then raise exception 'seed 2041'; end if;
  if public.add_georgian_holidays(2041) <> 0 then raise exception 'seed is not idempotent'; end if;
  begin perform public.add_georgian_holidays(1999); raise exception 'year 1999 accepted'; exception when sqlstate '22023' then null; end;
  insert into public.public_holidays (holiday_date, name, is_official) values ('2027-03-02', 'Company day', false);
  if public.leave_working_days('2027-03-01', '2027-03-05') <> 3 then raise exception 'custom holiday not counted'; end if;
  delete from public.public_holidays where name = 'Company day';
  if public.leave_working_days('2027-03-01', '2027-03-05') <> 4 then raise exception 'custom holiday not removed'; end if;
end $$;
reset role;
select pg_temp.as_user(:ann);
set role authenticated;
select pg_temp.expect_error($$select public.add_georgian_holidays(2042)$$, 'Only a CEO or developer');
select pg_temp.expect_error($$insert into public.public_holidays (holiday_date, name) values ('2027-03-02', 'x')$$, 'row-level security');
do $$ begin if (select count(*) from public.public_holidays) < 200 then raise exception 'employee cannot read holidays'; end if; end $$;
reset role;

-- ===== B. what the request form offers =====
select pg_temp.as_user(:ann);
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();
  if (o->>'replacement_required')::boolean is not true then raise exception 'replacement should be required'; end if;
  if jsonb_array_length(o->'replacements') <> 3 then raise exception 'replacements: %', o->'replacements'; end if;     -- head + Bob + Cat
  if exists (select 1 from jsonb_array_elements(o->'replacements') r where r->>'name' = 'Ann A') then raise exception 'offered self as replacement'; end if;
  if not exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'kind' = 'Department head' and a->>'name' = 'Hanna Head') then raise exception 'head not offered'; end if;
  if not exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'kind' = 'CEO') then raise exception 'CEO not offered'; end if;
  if exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'kind' = 'Developer') then raise exception 'developer offered to an employee'; end if;
end $$;
reset role;
select pg_temp.as_user(:lhead);
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();
  if exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'name' = 'Hanna Head') then raise exception 'head offered as own approver'; end if;
  if jsonb_array_length(o->'replacements') <> 3 then raise exception 'head replacements'; end if;
end $$;
reset role;
select pg_temp.as_user(:sol);
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();
  if (o->>'replacement_required')::boolean then raise exception 'solo employee must not need a replacement'; end if;
end $$;
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ declare o jsonb; begin
  o := public.leave_form_options();
  if not exists (select 1 from jsonb_array_elements(o->'approvers') a where a->>'kind' = 'Developer') then raise exception 'CEO cannot pick a developer to approve'; end if;
  if jsonb_array_length(o->'replacements') <> 0 then raise exception 'CEO has no replacements'; end if;
end $$;
reset role;

-- ===== C. requesting =====
select pg_temp.as_user(:ann);
set role authenticated;
do $$ declare r public.leave_requests; b record; begin
  r := public.request_leave('vacation', '2027-03-01', '2027-03-05', ' Family trip ', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003');
  if r.status <> 'pending' or r.comment <> 'Family trip' then raise exception 'request row: %', to_jsonb(r); end if;
  select * into b from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category = 'vacation';
  if b.allowance <> 24 or b.used <> 0 or b.pending <> 4 or b.remaining <> 20 then raise exception 'balance after request: %', to_jsonb(b); end if;
  select * into b from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category = 'unpaid';
  if b.allowance <> 15 or b.remaining <> 15 then raise exception 'unpaid balance'; end if;
  select * into b from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category = 'day_off';
  if b.allowance <> 4 or b.remaining <> 4 then raise exception 'day off balance'; end if;
end $$;
-- invalid requests
select pg_temp.expect_error($$select public.request_leave('vacation','2027-04-05','2027-04-06','x', null, '30000000-0000-0000-0000-000000000003')$$, 'who should approve');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-04-05','2027-04-06','x','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003')$$, 'someone else');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-04-05','2027-04-06','x','30000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000003')$$, 'department head or a CEO');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-04-05','2027-04-06','x','10000000-0000-0000-0000-0000000000f1','30000000-0000-0000-0000-000000000003')$$, 'department head or a CEO');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-04-05','2027-04-06','x','30000000-0000-0000-0000-000000000001', null)$$, 'Choose a replacement');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-04-05','2027-04-06','x','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005')$$, 'replacement must be');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-04-05','2027-04-06','x','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002')$$, 'replacement must be');
select pg_temp.expect_error($$select public.request_leave('holiday','2027-04-05','2027-04-06','x','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003')$$, 'leave type');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-04-06','2027-04-05','x','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003')$$, 'cannot be before');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-03-06','2027-03-07','x','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003')$$, 'no working days');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-03-04','2027-03-08','x','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003')$$, 'overlaps');
select pg_temp.expect_error($$select public.request_leave('vacation','2027-01-01','2028-06-01','x','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003')$$, 'one year');
-- only 4 days off a year: 5 working days requested (3 May 2027 is Orthodox Easter Monday)
select pg_temp.expect_error($$select public.request_leave('day_off','2027-05-03','2027-05-10','x','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003')$$, 'Not enough days left for day off in 2027: 4 left, 5 requested');
-- a leave across New Year is split by year (unpaid: 5 days in 2027, 2 in 2028)
do $$ declare r public.leave_requests; b record; begin
  r := public.request_leave('unpaid', '2027-12-27', '2028-01-04', null, '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004');
  select * into b from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category = 'unpaid';
  if b.pending <> 5 or b.remaining <> 10 then raise exception 'year split 2027: %', to_jsonb(b); end if;
  select * into b from public.leave_balance('30000000-0000-0000-0000-000000000002', 2028) where category = 'unpaid';
  if b.pending <> 2 or b.remaining <> 13 then raise exception 'year split 2028: %', to_jsonb(b); end if;
  perform set_config('test.split', r.id::text, false);
end $$;
-- the others cannot see Ann's balance or requests through the API
reset role;
select pg_temp.as_user(:bob);
set role authenticated;
select pg_temp.expect_error($$select * from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027)$$, 'cannot see');
do $$ begin if exists (select 1 from public.leave_requests where employee_id <> '30000000-0000-0000-0000-000000000003') then raise exception 'employee sees others'' requests'; end if; end $$;
select pg_temp.expect_error($$insert into public.leave_requests (employee_id, category, start_date, end_date) values ('30000000-0000-0000-0000-000000000003','vacation','2027-09-01','2027-09-02')$$, 'permission denied');
select pg_temp.expect_error($$update public.leave_requests set status = 'approved'$$, 'permission denied');
reset role;

-- a CEO asks another CEO / developer
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ declare r public.leave_requests; begin
  r := public.request_leave('vacation', '2027-06-01', '2027-06-02', null, '10000000-0000-0000-0000-0000000000f1', null);
  if r.replacement_id is not null then raise exception 'CEO replacement stored'; end if;
end $$;
select pg_temp.expect_error($$select public.request_leave('vacation','2027-08-02','2027-08-03',null,'30000000-0000-0000-0000-000000000001', null)$$, 'another CEO or developer');
reset role;

-- ===== D. deciding =====
select set_config('test.ann_vac', (select id::text from public.leave_requests where employee_id='30000000-0000-0000-0000-000000000002' and category='vacation' limit 1), false);
select pg_temp.as_user(:bob);                      -- a colleague
set role authenticated;
select pg_temp.expect_error(format($q$select public.decide_leave(%L,'approved')$q$, current_setting('test.ann_vac')), 'Only a CEO, developer or the department head');
reset role;
select pg_temp.as_user(:ann);                      -- cannot decide her own
set role authenticated;
select pg_temp.expect_error(format($q$select public.decide_leave(%L,'approved')$q$, current_setting('test.ann_vac')), 'own leave');
reset role;
select pg_temp.as_user(:alice);                    -- another department's head
set role authenticated;
select pg_temp.expect_error(format($q$select public.decide_leave(%L,'approved')$q$, current_setting('test.ann_vac')), 'Only a CEO, developer or the department head');
reset role;

select pg_temp.as_user(:lhead);                    -- the department head approves
set role authenticated;
do $$ declare id uuid; r public.leave_requests; b record; begin
  select l.id into id from public.leave_requests l where l.employee_id='30000000-0000-0000-0000-000000000002' and l.category='vacation';
  r := public.decide_leave(id, 'approved', ' enjoy ');
  if r.status <> 'approved' or r.decided_by <> '30000000-0000-0000-0000-000000000001' or r.decision_comment <> 'enjoy' then raise exception 'approval row'; end if;
  select * into b from public.leave_balances_all(2027) x where x.employee_id='30000000-0000-0000-0000-000000000002' and x.category='vacation';
  if b.used <> 4 or b.pending <> 0 or b.remaining <> 20 then raise exception 'balance after approval: %', to_jsonb(b); end if;
  begin perform public.decide_leave(id, 'rejected'); raise exception 'decided twice'; exception when sqlstate '22023' then null; end;
end $$;
reset role;

-- a replacement on approved leave cannot cover for someone else on the same days
select pg_temp.as_user(:cat);
set role authenticated;
select pg_temp.expect_error($$select public.request_leave('vacation','2027-03-02','2027-03-02','x','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002')$$, 'on approved leave');
-- allowance lowered after the request: a head cannot approve, a developer can
do $$ declare r public.leave_requests; begin
  r := public.request_leave('vacation', '2027-07-05', '2027-07-07', null, '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003');
  perform set_config('test.cat_leave', r.id::text, false);
end $$;
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin perform public.set_leave_allowance('30000000-0000-0000-0000-000000000004', 2027, 'vacation', 1); end $$;
reset role;
select pg_temp.as_user(:lhead);
set role authenticated;
select pg_temp.expect_error(format($q$select public.decide_leave(%L,'approved')$q$, current_setting('test.cat_leave')), 'exceed');
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ declare r public.leave_requests; begin
  r := public.decide_leave(current_setting('test.cat_leave')::uuid, 'approved', 'developer override');
  if r.status <> 'approved' then raise exception 'developer approval'; end if;
end $$;
reset role;

-- CEO approves / rejects
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ declare r public.leave_requests; begin
  r := public.decide_leave(current_setting('test.split')::uuid, 'rejected', 'Busy season');
  if r.status <> 'rejected' or r.decision_comment <> 'Busy season' then raise exception 'rejection'; end if;
  -- rejected days are released
  if (select pending from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category = 'unpaid') <> 0 then raise exception 'rejected days still reserved'; end if;
  -- the CEO's own request is decided by someone else
  begin perform public.decide_leave((select id from public.leave_requests where employee_id = '10000000-0000-0000-0000-0000000000c1'), 'approved'); raise exception 'CEO approved own'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin perform public.decide_leave((select id from public.leave_requests where employee_id = '10000000-0000-0000-0000-0000000000c1'), 'approved'); end $$;
reset role;

-- ===== E. cancelling =====
select pg_temp.as_user(:ann);
set role authenticated;
do $$ declare r public.leave_requests; begin
  r := public.request_leave('unpaid', '2027-10-04', '2027-10-05', null, '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003');
  r := public.cancel_leave(r.id);
  if r.status <> 'cancelled' then raise exception 'owner cancel'; end if;
  if (select pending from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category = 'unpaid') <> 0 then raise exception 'cancelled days still reserved'; end if;
  -- approved but in the future: the owner may still cancel it
  r := public.cancel_leave((select id from public.leave_requests where employee_id='30000000-0000-0000-0000-000000000002' and category='vacation' and status='approved'));
  if r.status <> 'cancelled' then raise exception 'owner cancel approved future'; end if;
  if (select used from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category = 'vacation') <> 0 then raise exception 'days not released'; end if;
  begin perform public.cancel_leave(r.id); raise exception 'cancelled twice'; exception when sqlstate '22023' then null; end;
end $$;
reset role;
-- someone else's leave, a started leave
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  perform public.dev_save_leave(null, '30000000-0000-0000-0000-000000000003', 'vacation', '2026-01-12', '2026-01-13', 'back-dated', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 'approved', 'ok');
end $$;
reset role;
select pg_temp.as_user(:bob);
set role authenticated;
select pg_temp.expect_error(format($q$select public.cancel_leave(%L)$q$, (select id from public.leave_requests where employee_id='30000000-0000-0000-0000-000000000003' and start_date='2026-01-12')), 'already started');
select pg_temp.expect_error(format($q$select public.cancel_leave(%L)$q$, current_setting('test.cat_leave')), 'cannot cancel');
reset role;
select pg_temp.as_user(:lhead);
set role authenticated;
select pg_temp.expect_error(format($q$select public.cancel_leave(%L)$q$, (select id from public.leave_requests where employee_id='30000000-0000-0000-0000-000000000003' and start_date='2026-01-12')), 'reason');
do $$ declare r public.leave_requests; begin
  r := public.cancel_leave((select id from public.leave_requests where employee_id='30000000-0000-0000-0000-000000000003' and start_date='2026-01-12'), 'Entered by mistake');
  if r.status <> 'cancelled' or r.decision_comment <> 'Entered by mistake' or r.decided_by <> '30000000-0000-0000-0000-000000000001' then raise exception 'head cancel'; end if;
end $$;
reset role;
-- a CEO cannot cancel a developer's leave, a developer can
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  perform public.dev_save_leave(null, '10000000-0000-0000-0000-0000000000f1', 'day_off', '2027-11-01', '2027-11-01', null, '10000000-0000-0000-0000-0000000000c1', null, 'approved', null);
end $$;
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
select pg_temp.expect_error(format($q$select public.cancel_leave(%L,'Not needed any more')$q$, (select id from public.leave_requests where employee_id='10000000-0000-0000-0000-0000000000f1' and start_date='2027-11-01')), 'Only a developer can change');
reset role;

-- ===== F. listing =====
select pg_temp.as_user(:ann);
set role authenticated;
do $$ declare n int; r record; begin
  select count(*) into n from public.list_leaves('mine');
  if n <> 3 then raise exception 'Ann should have 3 requests (cancelled, cancelled, rejected), got %', n; end if;
  select * into r from public.list_leaves('mine') where start_date = '2027-03-01';
  if r.replacement_name <> 'Bob B' or r.approver_name <> 'Hanna Head' or r.working_days <> 4 or r.employee_name <> 'Ann A' then raise exception 'names not resolved: %', to_jsonb(r); end if;
  if (select count(*) from public.list_leaves('mine', '2027-12-01', '2027-12-31')) <> 1 then raise exception 'date filter'; end if;
  begin perform * from public.list_leaves('managed'); raise exception 'employee listed others'; exception when sqlstate '42501' then null; end;
  begin perform public.leave_balances_all(2027); raise exception 'employee read all balances'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select pg_temp.as_user(:lhead);
set role authenticated;
do $$ begin
  if exists (select 1 from public.list_leaves('managed') where department_id is distinct from (select id from public.departments where name = 'Leave Lab')) then raise exception 'head sees other departments'; end if;
  if not exists (select 1 from public.list_leaves('managed') where employee_name = 'Ann A') then raise exception 'head cannot see own department'; end if;
  if (select count(distinct x.employee_id) from public.leave_balances_all(2027) x) <> 4 then raise exception 'head balances scope'; end if;
end $$;
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if (select count(*) from public.list_leaves('managed')) < (select count(*) from public.list_leaves('mine')) + 3 then raise exception 'CEO should see everyone''s leaves'; end if;
  if not exists (select 1 from public.list_leaves('managed') where employee_name = 'Dev Eloper') then raise exception 'CEO cannot see the developer''s leave'; end if;
  if not exists (select 1 from public.leave_balances_all(2027) x where x.employee_id = '10000000-0000-0000-0000-0000000000f1') then raise exception 'developer missing from balances'; end if;
end $$;
reset role;

-- ===== G. allowances and company defaults =====
select pg_temp.as_user(:ceo);
set role authenticated;
select pg_temp.expect_error($$select public.set_leave_allowance('10000000-0000-0000-0000-0000000000f1', 2027, 'vacation', 30)$$, 'Only a developer can change');
select pg_temp.expect_error($$select public.set_leave_allowance('30000000-0000-0000-0000-000000000002', 2027, 'vacation', 400)$$, 'between 0 and 366');
select pg_temp.expect_error($$select public.set_leave_allowance('30000000-0000-0000-0000-000000000002', 2027, 'sick', 3)$$, 'leave type');
do $$ begin
  perform public.set_leave_allowance('30000000-0000-0000-0000-000000000002', 2027, 'vacation', 28);
  if (select allowance from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category='vacation') <> 28 then raise exception 'override'; end if;
  perform public.set_leave_allowance('30000000-0000-0000-0000-000000000002', 2027, 'vacation', null);
  if (select allowance from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category='vacation') <> 24 then raise exception 'override not removed'; end if;
  update public.company_settings set leave_vacation_days = 25;
  if (select allowance from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category='vacation') <> 25 then raise exception 'company default'; end if;
  update public.company_settings set leave_vacation_days = 24;
  begin update public.company_settings set leave_unpaid_days = -1; raise exception 'negative default accepted'; exception when check_violation then null; end;
end $$;
reset role;
select pg_temp.as_user(:ann);
set role authenticated;
select pg_temp.expect_error($$select public.set_leave_allowance('30000000-0000-0000-0000-000000000002', 2027, 'vacation', 99)$$, 'Only a CEO or developer');
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin perform public.set_leave_allowance('10000000-0000-0000-0000-0000000000f1', 2027, 'vacation', 30); end $$;
reset role;

-- ===== H. birth date and hire date =====
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  perform public.set_employee_dates('30000000-0000-0000-0000-000000000002', '1990-05-17', '2021-09-01');
  perform public.set_employee_dates('30000000-0000-0000-0000-000000000003', '1985-12-31', null);
  perform public.set_employee_dates('10000000-0000-0000-0000-0000000000c1', '1975-03-03', '2015-01-05');   -- own details
  begin perform public.set_employee_dates('10000000-0000-0000-0000-0000000000f1', '1980-01-01', '2020-01-01'); raise exception 'CEO changed a developer'; exception when sqlstate '42501' then null; end;
  begin perform public.set_employee_dates('30000000-0000-0000-0000-000000000002', '2999-01-01', null); raise exception 'future birth date'; exception when sqlstate '22023' then null; end;
  begin perform public.set_employee_dates('30000000-0000-0000-0000-000000000002', null, '1900-01-01'); raise exception 'hire date 1900'; exception when sqlstate '22023' then null; end;
  begin perform public.set_employee_dates('30000000-0000-0000-0000-000000000099', null, null); raise exception 'ghost'; exception when sqlstate 'P0002' then null; end;
  if (select count(*) from public.employee_profiles) < 3 then raise exception 'CEO cannot read profiles'; end if;
end $$;
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  perform public.set_employee_dates('10000000-0000-0000-0000-0000000000f1', '1980-01-01', '2020-01-01');
  perform public.set_employee_dates('10000000-0000-0000-0000-0000000000c1', '1975-03-03', '2015-01-05');
end $$;
reset role;
select pg_temp.as_user(:ann);
set role authenticated;
do $$ begin
  if (select count(*) from public.employee_profiles) <> 1 then raise exception 'employee should see only own profile'; end if;
  begin perform public.set_employee_dates('30000000-0000-0000-0000-000000000002', null, null); raise exception 'employee set own dates'; exception when sqlstate '42501' then null; end;
end $$;
select pg_temp.expect_error($$insert into public.employee_profiles (employee_id) values ('30000000-0000-0000-0000-000000000003')$$, 'permission denied');
reset role;
select pg_temp.as_user(:lhead);
set role authenticated;
do $$ begin if exists (select 1 from public.employee_profiles where employee_id <> '30000000-0000-0000-0000-000000000001') then raise exception 'head reads colleagues'' birthdays'; end if; end $$;
reset role;

-- ===== I. developer edits any leave =====
select pg_temp.as_user(:ceo);
set role authenticated;
select pg_temp.expect_error($$select public.dev_save_leave(null,'30000000-0000-0000-0000-000000000002','vacation','2027-09-01','2027-09-02',null,null,null,'approved',null)$$, 'Only a developer');
select pg_temp.expect_error($$select public.dev_delete_leave(gen_random_uuid())$$, 'Only a developer');
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ declare r public.leave_requests; lid uuid; begin
  r := public.dev_save_leave(null, '30000000-0000-0000-0000-000000000002', 'vacation', '2027-09-01', '2027-09-03', 'by dev', null, null, 'approved', null);
  if r.decided_by <> '10000000-0000-0000-0000-0000000000f1' then raise exception 'dev decided_by'; end if;
  lid := r.id;
  -- over the allowance is allowed for a developer, and shows as a negative remainder
  r := public.dev_save_leave(lid, '30000000-0000-0000-0000-000000000002', 'day_off', '2027-09-01', '2027-09-10', 'edited', null, '30000000-0000-0000-0000-000000000003', 'approved', 'fine');
  if r.category <> 'day_off' or r.end_date <> '2027-09-10' or r.replacement_id <> '30000000-0000-0000-0000-000000000003' then raise exception 'dev edit'; end if;
  if (select remaining from public.leave_balance('30000000-0000-0000-0000-000000000002', 2027) where category = 'day_off') >= 0 then raise exception 'negative remainder expected'; end if;
  begin perform public.dev_save_leave(null, '30000000-0000-0000-0000-000000000002', 'vacation', '2027-09-05', '2027-09-06', null, null, null, 'pending', null); raise exception 'overlap accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.dev_save_leave(lid, '30000000-0000-0000-0000-000000000002', 'vacation', '2027-09-01', '2027-09-03', null, null, null, 'maybe', null); raise exception 'bad status'; exception when sqlstate '22023' then null; end;
  r := public.dev_save_leave(lid, '30000000-0000-0000-0000-000000000002', 'day_off', '2027-09-01', '2027-09-10', 'edited', null, null, 'pending', null);
  if r.decided_by is not null or r.decided_at is not null then raise exception 'back to pending keeps decision'; end if;
  perform public.dev_delete_leave(lid);
  if exists (select 1 from public.leave_requests where leave_requests.id = lid) then raise exception 'not deleted'; end if;
  begin perform public.dev_delete_leave(lid); raise exception 'ghost delete'; exception when sqlstate 'P0002' then null; end;
end $$;
reset role;

-- ===== J. audit trail =====
do $$ declare a text; begin
  foreach a in array array['leave.request','leave.approve','leave.reject','leave.cancel','leave.allowance','leave.dev_create','leave.dev_update','leave.delete','employee.dates','holidays.seed'] loop
    if not exists (select 1 from public.audit_logs where action = a) then raise exception 'no audit row for %', a; end if;
  end loop;
  if exists (select 1 from public.audit_logs where action = 'public_holidays.insert' and created_at < now() - interval '1 hour') then null; end if;
end $$;

-- ===== K. deleting a person removes their leaves and dates =====
delete from public.employees where id = '30000000-0000-0000-0000-000000000005';
select pg_temp.as_user(:ann);
do $$ begin
  insert into public.employee_profiles (employee_id, birth_date) values ('30000000-0000-0000-0000-000000000003', '2000-01-01') on conflict do nothing;
  delete from public.employees where id = '30000000-0000-0000-0000-000000000003';
  if exists (select 1 from public.leave_requests where employee_id = '30000000-0000-0000-0000-000000000003') then raise exception 'leaves survived the employee'; end if;
  if exists (select 1 from public.employee_profiles where employee_id = '30000000-0000-0000-0000-000000000003') then raise exception 'profile survived the employee'; end if;
  -- Ann's leave that named Bob as replacement is kept, the name is just gone
  if exists (select 1 from public.leave_requests where replacement_id = '30000000-0000-0000-0000-000000000003') then raise exception 'dangling replacement'; end if;
end $$;

\echo 'PART 5 DB TESTS PASSED'
