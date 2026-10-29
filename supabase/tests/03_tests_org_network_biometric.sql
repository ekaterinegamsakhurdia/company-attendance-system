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

\echo '--- part 2 checks start'
reset role;

-- ids used below
\set ceo   '''00000000-0000-0000-0000-0000000000c1'''
\set alice '''00000000-0000-0000-0000-0000000000a1'''
\set bobu  '''00000000-0000-0000-0000-0000000000b1'''

-- (bob was hard-deleted at the end of 02; recreate two more employees for these tests)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1','dora@x.test'),('00000000-0000-0000-0000-0000000000e1','eve@x.test');
-- (migration 3's "department required" insert rule is tested in part 3; seed rows here bypass it)
alter table public.employees disable trigger employees_require_org_trg;
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email) values
 ('10000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d1','EMP004','Dora','D','dora@x.test'),
 ('10000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1','EMP005','Eve','E','eve@x.test');
alter table public.employees enable trigger employees_require_org_trg;

-- ===== A. seed + structure =====
do $$ begin
  if (select count(*) from public.departments where name in ('Advertising','Account Managers','Production','Copywriting','Design')) <> 5 then raise exception 'seed departments'; end if;
  if (select count(*) from public.job_roles j join public.departments d on d.id=j.department_id where d.name='Production') <> 3 then raise exception 'production roles'; end if;
  if (select count(*) from public.job_roles j join public.departments d on d.id=j.department_id where d.name<>'Production') <> 0 then raise exception 'roles outside production'; end if;
  -- case-insensitive uniqueness
  begin insert into public.departments(name) values ('advertising'); raise exception 'dup dept allowed';
  exception when unique_violation then null; end;
  -- re-running the seed part must not duplicate (idempotent)
  if (select count(*) from public.departments) <> 6 then raise exception 'dept count % (5 seeded + Test Dept)', (select count(*) from public.departments); end if;
end $$;

-- exact policy set after all migrations (26: the 25 before migration 15 plus office_rooms_select)
do $$ begin
  if (select count(*) from pg_policies where schemaname='public') <> 26 then
    raise exception 'unexpected policy count: %', (select count(*) from pg_policies where schemaname='public'); end if;
end $$;

-- ===== B. head + job role rules (as CEO) =====
select pg_temp.as_user(:ceo);
set role authenticated;

do $$ declare prod uuid; des uuid; ad uuid; montage uuid; opr uuid; begin
  select id into prod from public.departments where name='Production';
  select id into des  from public.departments where name='Design';
  select id into ad   from public.departments where name='Advertising';
  select id into montage from public.job_roles where name='Montage';
  select id into opr from public.job_roles where name='Operator';

  -- assign Alice + Dora to Production, Eve to Design
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000a1', prod, opr);
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000d1', prod, montage);
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000e1', des);

  -- head must belong to the department
  begin perform public.ceo_set_department_head(prod, '10000000-0000-0000-0000-0000000000e1'); raise exception 'non-member became head';
  exception when sqlstate '22023' then null; end;
  perform public.ceo_set_department_head(prod, '10000000-0000-0000-0000-0000000000a1');   -- Alice heads Production
  -- one head per person
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000a1', des); -- moving Alice clears headship
  if (select head_employee_id from public.departments where id=prod) is not null then raise exception 'headship not cleared on move'; end if;
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000a1', prod, opr);
  perform public.ceo_set_department_head(prod, '10000000-0000-0000-0000-0000000000a1');

  -- job roles
  perform public.ceo_set_employee_job_role('10000000-0000-0000-0000-0000000000d1', montage);
  begin perform public.ceo_set_employee_job_role('10000000-0000-0000-0000-0000000000e1', montage); raise exception 'role from another department accepted';
  exception when sqlstate '22023' then null; end;
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000d1', ad);   -- moving drops the role
  if (select job_role_id from public.employees where employee_number='EMP004') is not null then raise exception 'job role survived department change'; end if;
  begin perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000d1', prod); raise exception 'moved into a department with roles without choosing one';
  exception when sqlstate '22023' then null; end;
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000d1', prod, montage);
  begin perform public.ceo_set_employee_job_role('10000000-0000-0000-0000-0000000000d1', null); raise exception 'role cleared in a department that has roles';
  exception when sqlstate '22023' then null; end;
  perform public.ceo_set_employee_job_role('10000000-0000-0000-0000-0000000000d1', opr);
  perform public.ceo_set_employee_job_role('10000000-0000-0000-0000-0000000000d1', montage);
  if (select count(*) from public.audit_logs where action in ('department.head','employee.job_role')) < 4 then raise exception 'audit for org changes'; end if;
end $$;
-- direct client write of a mismatched role is blocked by the composite FK / privileges
select pg_temp.expect_error($$update public.employees set job_role_id=(select id from public.job_roles limit 1) where employee_number='EMP005'$$, 'permission denied');

-- ===== C. what a head can see =====
reset role;
-- give everyone one attendance row today-ish so there is something to see
insert into public.attendance (employee_id, work_date, clock_in, clock_out, worked_minutes, clockout_type) values
 ('10000000-0000-0000-0000-0000000000a1', '2026-09-01', '2026-09-01 07:00+00', '2026-09-01 15:00+00', 480, 'manual'),
 ('10000000-0000-0000-0000-0000000000d1', '2026-09-01', '2026-09-01 07:00+00', '2026-09-01 15:00+00', 480, 'manual'),
 ('10000000-0000-0000-0000-0000000000e1', '2026-09-01', '2026-09-01 07:00+00', '2026-09-01 15:00+00', 480, 'manual');

select pg_temp.as_user(:alice);   -- Alice = head of Production (members: Alice, Dora)
set role authenticated;
do $$ begin
  if (select count(*) from public.employees) <> 2 then raise exception 'head sees % employees', (select count(*) from public.employees); end if;
  if (select count(*) from public.attendance where work_date='2026-09-01') <> 2 then raise exception 'head attendance rows'; end if;
  if exists (select 1 from public.attendance where employee_id='10000000-0000-0000-0000-0000000000e1') then raise exception 'head sees other department'; end if;
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'head sees audit'; end if;
  if public.head_department_id() is null then raise exception 'head_department_id'; end if;
end $$;
select pg_temp.expect_error($$select public.ceo_save_attendance(null,'10000000-0000-0000-0000-0000000000d1',now(),null,'nope')$$, 'Only the CEO');
select pg_temp.expect_error($$select public.ceo_set_department_head((select id from public.departments limit 1), null)$$, 'Only the CEO');
select pg_temp.expect_error($$update public.attendance set worked_minutes=1$$, 'permission denied');

reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');   -- Eve: Design member, not a head
set role authenticated;
do $$ begin
  if (select count(*) from public.employees) <> 1 then raise exception 'non-head sees colleagues'; end if;
  if (select count(*) from public.attendance) <> 1 then raise exception 'non-head sees others attendance'; end if;
end $$;

-- ===== D. network enforcement =====
reset role;
select pg_temp.as_user(:ceo, '203.0.113.7');
set role authenticated;
-- cannot require a network before one exists
select pg_temp.expect_error($$update public.company_settings set require_company_network = true$$, 'at least one active company network');
-- CEO adds the network they are currently on
do $$ declare n public.allowed_networks; begin
  n := public.ceo_add_my_network('Office wifi');
  if n.network <> '203.0.113.7/32'::cidr then raise exception 'network %', n.network; end if;
end $$;
-- without the trusted header the CEO cannot add a network (no fallback to spoofable headers)
select pg_temp.as_user(:ceo);
select pg_temp.expect_error($$select public.ceo_add_my_network('x')$$, 'Could not detect');
-- IPv6 -> /64
select pg_temp.as_user(:ceo, '2001:db8:1:2:aaaa:bbbb:cccc:dddd');
do $$ declare n public.allowed_networks; begin
  n := public.ceo_add_my_network('Office v6');
  if n.network <> '2001:db8:1:2::/64'::cidr then raise exception 'v6 network %', n.network; end if;
end $$;
select pg_temp.as_user(:ceo, '203.0.113.7');
update public.company_settings set require_company_network = true;

-- status RPC
do $$ declare s jsonb; begin
  s := public.my_network_status();
  if not (s->>'on_company_network')::boolean or s->>'ip' <> '203.0.113.7' or not (s->>'required')::boolean then raise exception 'status %', s; end if;
end $$;

-- Dora (production employee) tries from the wrong IP, no header, spoofed x-forwarded-for, then right IP
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', '198.51.100.99');
set role authenticated;
select pg_temp.expect_error($$select public.clock_in()$$, 'LP001');
do $$ begin if (public.my_network_status()->>'on_company_network')::boolean then raise exception 'status says on network'; end if; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');       -- only x-forwarded-for present (forged to the office IP below)
set role authenticated;
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.7","x-real-ip":"203.0.113.7"}', false);
select pg_temp.expect_error($$select public.clock_in()$$, 'LP001');   -- spoofable headers are ignored
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', '203.0.113.7');
set role authenticated;
do $$ declare r public.attendance; begin
  r := public.clock_in();
  if r.clock_in_biometric then raise exception 'biometric flag set without biometric'; end if;
end $$;
select pg_temp.expect_error($$select public.clock_in()$$, 'already clocked in');
-- clock out from elsewhere is refused too, and the record stays open
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', '198.51.100.99');
set role authenticated;
select pg_temp.expect_error($$select public.clock_out()$$, 'LP001');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', '2001:db8:1:2:1111:2222:3333:4444');   -- inside the v6 /64
set role authenticated;
do $$ declare r public.attendance; begin r := public.clock_out(); if r.clock_out is null then raise exception 'v6 clock out'; end if; end $$;

-- last-network guard
reset role;
select pg_temp.as_user(:ceo, '203.0.113.7');
set role authenticated;
do $$ declare ids uuid[]; begin
  select array_agg(id) into ids from public.allowed_networks;
  update public.allowed_networks set is_active=false where id = ids[1];                 -- one of two: fine
  begin update public.allowed_networks set is_active=false where id = ids[2]; raise exception 'last network deactivated';
  exception when sqlstate '22023' then null; end;
  begin delete from public.allowed_networks where is_active; raise exception 'last network deleted';
  exception when sqlstate '22023' then null; end;
  update public.allowed_networks set is_active=true where id = ids[1];
end $$;

-- employees cannot touch the network list
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1', '203.0.113.7');
set role authenticated;
do $$ begin if (select count(*) from public.allowed_networks) <> 0 then raise exception 'employee reads networks'; end if; end $$;
select pg_temp.expect_error($$insert into public.allowed_networks(label, network) values ('x','10.0.0.0/8')$$, 'row-level security');

-- ===== E. biometric tokens =====
reset role;
update public.company_settings set require_company_network = false, require_biometric = true;
-- Eve enrols a "device" (service role does this in reality)
insert into public.webauthn_credentials (id, employee_id, credential_id, public_key, device_name)
values ('20000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000e1','cred-eve','pk-eve','Eve phone'),
       ('20000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-0000000000d1','cred-dora','pk-dora','Dora laptop');
insert into public.biometric_verifications (id, employee_id, action) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000e1','clock_in'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-0000000000e1','clock_out'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-0000000000d1','clock_in');
insert into public.biometric_verifications (id, employee_id, action, expires_at) values
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-0000000000e1','clock_in', now() - interval '1 second');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select pg_temp.expect_error($$select public.clock_in()$$, 'LP002');                                                        -- no token
select pg_temp.expect_error($$select public.clock_in('30000000-0000-0000-0000-000000000003')$$, 'LP002');                  -- someone else's token
select pg_temp.expect_error($$select public.clock_in('30000000-0000-0000-0000-000000000002')$$, 'LP002');                  -- wrong action
select pg_temp.expect_error($$select public.clock_in('30000000-0000-0000-0000-000000000004')$$, 'LP002');                  -- expired
select pg_temp.expect_error($$select public.clock_in('00000000-0000-0000-0000-00000000dead')$$, 'LP002');                  -- unknown
do $$ declare r public.attendance; begin
  r := public.clock_in('30000000-0000-0000-0000-000000000001');
  if not r.clock_in_biometric then raise exception 'biometric flag missing'; end if;
end $$;
select pg_temp.expect_error($$select public.clock_out('30000000-0000-0000-0000-000000000001')$$, 'LP002');                 -- token already used / wrong action
do $$ declare r public.attendance; begin
  r := public.clock_out('30000000-0000-0000-0000-000000000002');
  if not r.clock_out_biometric then raise exception 'clock_out biometric flag'; end if;
end $$;
select pg_temp.expect_error($$select public.clock_out('30000000-0000-0000-0000-000000000002')$$, 'not clocked in');

-- a failed clock-in (already clocked in today) must not burn a fresh token
reset role;
insert into public.biometric_verifications (id, employee_id, action) values ('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-0000000000e1','clock_in');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select pg_temp.expect_error($$select public.clock_in('30000000-0000-0000-0000-000000000005')$$, 'already clocked in');
reset role;
do $$ begin if (select used_at from public.biometric_verifications where id='30000000-0000-0000-0000-000000000005') is not null then raise exception 'token burned by failed clock-in'; end if; end $$;

-- ===== F. who can see/remove devices =====
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
do $$ begin
  if (select count(*) from public.webauthn_credentials) <> 1 then raise exception 'eve sees % devices', (select count(*) from public.webauthn_credentials); end if;
end $$;
select pg_temp.expect_error($$select public_key from public.webauthn_credentials$$, 'permission denied');
select pg_temp.expect_error($$select * from public.webauthn_challenges$$, 'permission denied');
select pg_temp.expect_error($$select * from public.biometric_verifications$$, 'permission denied');
select pg_temp.expect_error($$insert into public.biometric_verifications(employee_id, action) values ('10000000-0000-0000-0000-0000000000e1','clock_in')$$, 'permission denied');
select pg_temp.expect_error($$select public.remove_webauthn_credential('20000000-0000-0000-0000-0000000000d1')$$, 'only remove your own');
do $$ begin perform public.remove_webauthn_credential('20000000-0000-0000-0000-0000000000e1'); end $$;
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if (select count(*) from public.webauthn_credentials) <> 1 then raise exception 'ceo sees devices'; end if;
  perform public.remove_webauthn_credential('20000000-0000-0000-0000-0000000000d1');   -- CEO may remove anyone's
  if (select count(*) from public.audit_logs where action='webauthn.remove') <> 0 then raise exception 'device removals are routine, not shown to a CEO'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.audit_logs where action='webauthn.remove') <> 2 then raise exception 'device removal audit'; end if;
end $$;
set role authenticated;

-- ===== G. settings accessor exposes the flags to everyone signed in =====
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
do $$ declare b boolean; begin select require_biometric into b from public.get_app_settings(); if b is not true then raise exception 'settings flag'; end if; end $$;
reset role;
\echo 'PART 2 DB TESTS PASSED'
