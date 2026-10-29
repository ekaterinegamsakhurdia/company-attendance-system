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

\echo '--- part 3 checks start (developer role)'
reset role;

\set ceo   '''00000000-0000-0000-0000-0000000000c1'''
\set alice '''00000000-0000-0000-0000-0000000000a1'''
\set dev   '''00000000-0000-0000-0000-0000000000f1'''
\set eve   '''00000000-0000-0000-0000-0000000000e1'''

-- ===== A. account types + required department / job role on insert =====
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1','dev@x.test'),('00000000-0000-0000-0000-0000000000f2','gus@x.test');

do $$ declare prod uuid; des uuid; ad uuid; montage uuid; other_role uuid; inactive uuid; begin
  select id into prod from public.departments where name='Production';
  select id into des  from public.departments where name='Design';
  select id into ad   from public.departments where name='Advertising';
  select id into montage from public.job_roles where name='Montage';

  -- developers and CEOs need no department
  insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, role)
  values ('10000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f1','DEV001','Dev','Eloper','dev@x.test','developer');

  begin insert into public.employees (employee_number, first_name, last_name, role) values ('X1','a','b','boss'); raise exception 'unknown role accepted';
  exception when check_violation then null; end;

  -- employees do
  begin insert into public.employees (employee_number, first_name, last_name, email) values ('X2','a','b','x2@x.test'); raise exception 'employee without department accepted';
  exception when sqlstate '22023' then if sqlerrm not ilike '%Choose a department%' then raise; end if; end;
  begin insert into public.employees (employee_number, first_name, last_name, email, department_id) values ('X3','a','b','x3@x.test', prod); raise exception 'employee without job role accepted in Production';
  exception when sqlstate '22023' then if sqlerrm not ilike '%job role%' then raise; end if; end;
  -- a role from another department
  begin insert into public.employees (employee_number, first_name, last_name, email, department_id, job_role_id) values ('X4','a','b','x4@x.test', des, montage); raise exception 'foreign job role accepted';
  exception when sqlstate '22023' then null; end;
  -- inactive department
  insert into public.departments(name, is_active) values ('Closed Dept', false);
  begin insert into public.employees (employee_number, first_name, last_name, email, department_id) values ('X5','a','b','x5@x.test', (select id from public.departments where name='Closed Dept')); raise exception 'inactive department accepted';
  exception when sqlstate '22023' then null; end;

  -- valid: Production + role; Design (no roles yet) without a role
  insert into public.employees (employee_number, first_name, last_name, email, department_id, job_role_id) values ('P1','Pia','P','p1@x.test', prod, montage);
  insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, department_id) values
   ('10000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f2','EMP006','Gus','G','gus@x.test', des);
  -- once Design has a role, it is required there as well
  insert into public.job_roles(department_id, name) values (des, 'Illustrator');
  begin insert into public.employees (employee_number, first_name, last_name, email, department_id) values ('X6','a','b','x6@x.test', des); raise exception 'role not required after Design got roles';
  exception when sqlstate '22023' then null; end;
  -- an inactive role does not count as "the department has roles"
  update public.job_roles set is_active=false where department_id=des and name='Illustrator';
  insert into public.employees (employee_number, first_name, last_name, email, department_id) values ('X7','Ina','I','x7@x.test', des);
  delete from public.employees where employee_number in ('X7');
  delete from public.job_roles where department_id=des and name='Illustrator';
  delete from public.employees where employee_number='P1';
  delete from public.departments where name='Closed Dept';
end $$;

-- policy count: 17 from migrations 1-4 (employees_select was replaced, not added) + 7 from migration 5
do $$ begin
  if (select count(*) from pg_policies where schemaname='public') <> 26 then
    raise exception 'unexpected policy count: %', (select count(*) from pg_policies where schemaname='public'); end if;
end $$;

-- ===== B. who can see developer accounts =====
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  -- CEOs can SEE the developer (read-only, see test 05 for what they cannot change)
  if (select count(*) from public.employees where role='developer') <> 1 then raise exception 'CEO cannot see the developer account'; end if;
  if (select count(*) from public.employees) < 6 then raise exception 'CEO lost sight of accounts'; end if;
  if not public.is_ceo() then raise exception 'ceo is_ceo'; end if;
  if public.is_developer() then raise exception 'ceo is_developer'; end if;
end $$;
reset role;

select pg_temp.as_user(:alice);   -- a head
set role authenticated;
do $$ begin if exists (select 1 from public.employees where role='developer') then raise exception 'head can see a developer'; end if; end $$;
reset role;

select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  if (select count(*) from public.employees where role='developer') <> 1 then raise exception 'developer cannot see own row'; end if;
  if (select count(*) from public.employees) < 6 then raise exception 'developer cannot see everyone'; end if;
  if not public.is_developer() or not public.is_ceo() then raise exception 'developer flags'; end if;
  -- everything a CEO can read
  perform 1 from public.audit_logs limit 1;
  perform 1 from public.attendance limit 1;
  perform 1 from public.allowed_networks limit 1;
end $$;
reset role;

-- ===== C. CEO and employees cannot use developer powers or touch developers =====
select pg_temp.as_user(:ceo);
set role authenticated;
select pg_temp.expect_error($$select public.dev_set_employee_role('10000000-0000-0000-0000-0000000000f2', 'ceo')$$, 'Only a developer');
select pg_temp.expect_error($$select public.dev_update_employee('10000000-0000-0000-0000-0000000000f2','EMP006','Gus','G',null,null,true)$$, 'Only a developer');
select pg_temp.expect_error($$select public.dev_delete_department((select id from public.departments where name='Test Dept'))$$, 'Only a developer');
select pg_temp.expect_error($$select public.dev_delete_job_role((select id from public.job_roles limit 1))$$, 'Only a developer');
select pg_temp.expect_error($$select public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000f1', (select id from public.departments where name='Design'))$$, 'not found');
select pg_temp.expect_error($$select public.ceo_set_employee_job_role('10000000-0000-0000-0000-0000000000f1', null)$$, 'not found');
select pg_temp.expect_error($$update public.employees set role='developer' where employee_number='EMP006'$$, 'permission denied');
reset role;

select pg_temp.as_user(:eve);
set role authenticated;
select pg_temp.expect_error($$select public.dev_set_employee_role('10000000-0000-0000-0000-0000000000f2', 'ceo')$$, 'Only a developer');
reset role;

-- ===== D. the CEO now has to pick a department AND role when moving someone =====
select pg_temp.as_user(:ceo);
set role authenticated;
select pg_temp.expect_error($$select public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000f2', null)$$, 'Choose a department');
select pg_temp.expect_error($$select public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000f2', (select id from public.departments where name='Production'))$$, 'job role');
do $$ begin
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000f2',
    (select id from public.departments where name='Production'), (select id from public.job_roles where name='Motion Designer'));
  if (select job_role_id from public.employees where employee_number='EMP006') <> (select id from public.job_roles where name='Motion Designer') then raise exception 'move with role'; end if;
  perform public.ceo_set_employee_department('10000000-0000-0000-0000-0000000000f2', (select id from public.departments where name='Design'));
end $$;
reset role;

-- ===== E. developer powers =====
select pg_temp.as_user(:dev);
set role authenticated;
do $$ declare gus uuid := '10000000-0000-0000-0000-0000000000f2'; before_audit int; begin
  -- admin rights come along
  perform public.ceo_set_employee_department(gus, (select id from public.departments where name='Advertising'));
  perform public.ceo_set_employee_department(gus, (select id from public.departments where name='Design'));

  -- account type changes
  perform public.dev_set_employee_role(gus, 'ceo');
  if (select role from public.employees where id=gus) <> 'ceo' then raise exception 'promote to ceo'; end if;
  perform public.dev_set_employee_role(gus, 'employee');
  if (select role from public.employees where id=gus) <> 'employee' then raise exception 'demote'; end if;
  begin perform public.dev_set_employee_role(gus, 'god'); raise exception 'unknown type accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.dev_set_employee_role('10000000-0000-0000-0000-0000000000f1', 'employee'); raise exception 'changed own type';
  exception when sqlstate '22023' then null; end;
  begin perform public.dev_set_employee_role('10000000-0000-0000-0000-000000000999', 'ceo'); raise exception 'ghost';
  exception when sqlstate 'P0002' then null; end;
  if (select count(*) from public.audit_logs where action='employee.role') <> 2 then raise exception 'role audit'; end if;

  -- promoting a department head to developer clears the headship and department
  perform public.dev_set_employee_role('10000000-0000-0000-0000-0000000000a1', 'developer');
  if (select department_id from public.employees where employee_number='EMP002') is not null then raise exception 'developer kept department'; end if;
  if (select head_employee_id from public.departments where name='Production') is not null then raise exception 'headship survived'; end if;
  perform public.dev_set_employee_role('10000000-0000-0000-0000-0000000000a1', 'employee');   -- back (now without department)
  perform public.dev_update_employee('10000000-0000-0000-0000-0000000000a1','EMP002','Alice','A',
    (select id from public.departments where name='Production'), (select id from public.job_roles where name='Operator'), true);
  perform public.ceo_set_department_head((select id from public.departments where name='Production'), '10000000-0000-0000-0000-0000000000a1');

  -- edit employee data
  perform public.dev_update_employee(gus,'EMP006',' Gustav ','Gee',(select id from public.departments where name='Design'),null,true);
  if (select first_name||' '||last_name from public.employees where id=gus) <> 'Gustav Gee' then raise exception 'edit name / trim'; end if;
  begin perform public.dev_update_employee(gus,'EMP002','Gustav','Gee',(select id from public.departments where name='Design'),null,true); raise exception 'duplicate number';
  exception when unique_violation then if sqlerrm not ilike '%already used%' then raise; end if; end;
  begin perform public.dev_update_employee(gus,'EMP006','','Gee',(select id from public.departments where name='Design'),null,true); raise exception 'empty name';
  exception when sqlstate '22023' then null; end;
  begin perform public.dev_update_employee(gus,'EMP006','Gustav','Gee',null,null,true); raise exception 'employee without department';
  exception when sqlstate '22023' then null; end;
  begin perform public.dev_update_employee(gus,'EMP006','Gustav','Gee',(select id from public.departments where name='Production'),null,true); raise exception 'Production without role';
  exception when sqlstate '22023' then null; end;
  begin perform public.dev_update_employee('10000000-0000-0000-0000-0000000000f1','DEV001','Dev','Eloper',null,null,false); raise exception 'deactivated self';
  exception when sqlstate '22023' then null; end;
  perform public.dev_update_employee(gus,'EMP006','Gustav','Gee',(select id from public.departments where name='Production'),(select id from public.job_roles where name='Montage'),true);
  if (select job_role_id from public.employees where id=gus) is null then raise exception 'role not saved'; end if;
  if (select count(*) from public.audit_logs where action='employee.update') < 2 then raise exception 'update audit'; end if;

  -- deactivating a head clears the headship
  perform public.ceo_set_department_head((select id from public.departments where name='Production'), gus);
  perform public.dev_update_employee(gus,'EMP006','Gustav','Gee',(select id from public.departments where name='Production'),(select id from public.job_roles where name='Montage'),false);
  if (select head_employee_id from public.departments where name='Production') is not null then raise exception 'inactive head kept'; end if;
  perform public.dev_update_employee(gus,'EMP006','Gustav','Gee',(select id from public.departments where name='Design'),null,true);
end $$;

-- departments and job roles: add / remove
do $$ declare d uuid; r uuid; begin
  insert into public.departments(name) values ('Temp Dept') returning id into d;
  insert into public.job_roles(department_id, name) values (d, 'Temp role') returning id into r;
  perform public.dev_delete_job_role(r);
  if exists (select 1 from public.job_roles where id=r) then raise exception 'role not deleted'; end if;
  insert into public.job_roles(department_id, name) values (d, 'Temp role 2');
  perform public.dev_delete_department(d);       -- roles go with it
  if exists (select 1 from public.job_roles where department_id=d) then raise exception 'roles survived'; end if;
  if (select count(*) from public.audit_logs where action='job_roles.delete') < 1 then raise exception 'job role delete audit'; end if;
  if (select count(*) from public.audit_logs where action='departments.delete') < 1 then raise exception 'department delete audit'; end if;
  -- cannot delete what is still in use
  begin perform public.dev_delete_department((select id from public.departments where name='Production')); raise exception 'deleted department with staff';
  exception when foreign_key_violation then null; end;
  begin perform public.dev_delete_job_role((select id from public.job_roles where name='Montage')); raise exception 'deleted a job role in use';
  exception when foreign_key_violation then null; end;
  begin perform public.dev_delete_department('10000000-0000-0000-0000-000000000999'); raise exception 'ghost dept';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- networks: the developer manages them like a CEO
do $$ declare n public.allowed_networks; begin
  insert into public.allowed_networks(label, network) values ('Dev VPN', '192.0.2.0/28');
  update public.allowed_networks set is_active=false where label='Dev VPN';
  delete from public.allowed_networks where label='Dev VPN';
end $$;

-- what the developer did is not shown to a CEO (migration 7); the developer sees all of it
reset role;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if (select count(*) from public.audit_logs where action in ('employee.role','employee.update')) <> 0 then raise exception 'CEO sees the developer audit trail'; end if;
end $$;
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  if (select count(*) from public.audit_logs where action in ('employee.role','employee.update')) < 3 then raise exception 'developer cannot see its own audit trail'; end if;
end $$;
reset role;

\echo 'PART 3 DB TESTS PASSED'
