\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.headers', '{"x-forwarded-for":"198.51.100.1"}', false);
end $$;

\echo '--- part 8 checks start (self profile + avatars)'
reset role;
\set ceo '''00000000-0000-0000-0000-0000000000c1'''
\set dev '''00000000-0000-0000-0000-0000000000f1'''
\set emp '''33000000-0000-0000-0000-000000000002'''
\set head '''33000000-0000-0000-0000-000000000001'''

create temp table snap as
  select id, employee_number, email, role, department_id, job_role_id, is_active from public.employees where auth_user_id = :emp;
delete from public.audit_logs;
update public.employee_profiles set office = 'Batumi', country = 'Georgia', daily_hours = 6
 where employee_id = (select id from snap);
insert into public.employee_profiles (employee_id, office, country, daily_hours)
  select id, 'Batumi', 'Georgia', 6 from snap on conflict (employee_id) do nothing;
create temp table ids as
  select (select id from public.employees where auth_user_id = '33000000-0000-0000-0000-000000000001') as head_emp,
         (select id from public.employees where auth_user_id = '33000000-0000-0000-0000-000000000002') as emp_emp;
grant select on pg_temp.snap, pg_temp.ids to authenticated;

-- 1. an employee changes their own name and birth date
select pg_temp.as_user(:emp);
set role authenticated;
select public.update_my_profile('  Ann   Marie ', 'Smith', date '1990-05-05');
reset role;
do $$
declare e public.employees; p public.employee_profiles; s record;
begin
  select * into e from public.employees where auth_user_id = '33000000-0000-0000-0000-000000000002';
  select * into p from public.employee_profiles where employee_id = e.id;
  select * into s from snap;
  if e.first_name <> 'Ann Marie' or e.last_name <> 'Smith' then raise exception 'name not saved or not normalised: % %', e.first_name, e.last_name; end if;
  if p.birth_date <> date '1990-05-05' then raise exception 'birth date not saved'; end if;
  if e.employee_number <> s.employee_number or e.email is distinct from s.email or e.role <> s.role
     or e.department_id is distinct from s.department_id or e.job_role_id is distinct from s.job_role_id or e.is_active <> s.is_active then
    raise exception 'update_my_profile changed more than the name';
  end if;
  if p.office <> 'Batumi' or p.country <> 'Georgia' or p.daily_hours <> 6 then raise exception 'update_my_profile wiped other profile fields'; end if;
  if not exists (select 1 from public.audit_logs where action = 'employee.self_update' and employee_id = e.id) then raise exception 'self update not audited'; end if;
end $$;

-- 2. validation
select pg_temp.as_user(:emp);
set role authenticated;
do $$ begin
  begin perform public.update_my_profile('', 'Smith', null); raise exception 'empty first name accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.update_my_profile('Ann', '   ', null); raise exception 'blank last name accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.update_my_profile(repeat('x', 101), 'Smith', null); raise exception 'long name accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.update_my_profile('Ann', 'Smith', current_date + 5); raise exception 'future birth date accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.update_my_profile('Ann', 'Smith', date '1850-01-01'); raise exception 'ancient birth date accepted';
  exception when sqlstate '22023' then null; end;
  -- clearing the birth date is allowed
  perform public.update_my_profile('Ann', 'Smith', null);
  if (select birth_date from public.employee_profiles where employee_id = public.current_employee_id()) is not null then
    raise exception 'birth date not cleared';
  end if;
end $$;

-- 3. no direct writes
do $$ begin
  begin update public.employees set first_name = 'Hacked' where auth_user_id = '33000000-0000-0000-0000-000000000002';
        if found then raise exception 'direct employees update worked'; end if;
  exception when insufficient_privilege then null; end;
  begin update public.employee_profiles set avatar_path = 'x/y.jpg'; if found then raise exception 'direct profile update worked'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 4. audit scope: CEOs do not see routine self-edits, developers do
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if exists (select 1 from public.audit_logs where action in ('employee.self_update', 'employee.avatar')) then raise exception 'CEO sees self-edit noise'; end if;
end $$;
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  if not exists (select 1 from public.audit_logs where action = 'employee.self_update') then raise exception 'developer misses the self-edit'; end if;
end $$;
reset role;

-- 5. avatars: only the owner (or a developer) sets a photo
select pg_temp.as_user(:emp);
set role authenticated;
do $$
declare mine uuid := public.current_employee_id(); other uuid;
begin
  select head_emp into other from pg_temp.ids;
  perform public.set_avatar(mine, '33000000-0000-0000-0000-000000000002/a1.jpg');
  if (select avatar_path from public.employee_profiles where employee_id = mine) <> '33000000-0000-0000-0000-000000000002/a1.jpg' then raise exception 'avatar not saved'; end if;
  if (select office from public.employee_profiles where employee_id = mine) <> 'Batumi' then raise exception 'set_avatar wiped the office'; end if;
  begin perform public.set_avatar(other, '33000000-0000-0000-0000-000000000001/a.jpg'); raise exception 'changed someone else''s photo';
  exception when sqlstate '42501' then null; end;
  begin perform public.set_avatar(mine, '33000000-0000-0000-0000-000000000001/a.jpg'); raise exception 'accepted a path in someone else''s folder';
  exception when sqlstate '22023' then null; end;
  begin perform public.set_avatar(mine, '33000000-0000-0000-0000-000000000002/../x.jpg'); raise exception 'accepted a path with ..';
  exception when sqlstate '22023' then null; end;
  begin perform public.set_avatar(mine, 'a1.jpg'); raise exception 'accepted a path outside any folder';
  exception when sqlstate '22023' then null; end;
  -- a name change keeps the photo
  perform public.update_my_profile('Ann', 'Smith', null);
  if (select avatar_path from public.employee_profiles where employee_id = mine) is null then raise exception 'update_my_profile removed the photo'; end if;
  perform public.set_avatar(mine, null);
  if (select avatar_path from public.employee_profiles where employee_id = mine) is not null then raise exception 'avatar not removed'; end if;
end $$;
reset role;

select pg_temp.as_user(:ceo);
set role authenticated;
do $$
declare target uuid;
begin
  select emp_emp into target from pg_temp.ids;
  begin perform public.set_avatar(target, '33000000-0000-0000-0000-000000000002/c.jpg'); raise exception 'CEO changed an employee photo';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

select pg_temp.as_user(:dev);
set role authenticated;
do $$
declare target uuid;
begin
  select emp_emp into target from pg_temp.ids;
  perform public.set_avatar(target, '33000000-0000-0000-0000-000000000002/d.jpg');
  if (select avatar_path from public.employee_profiles where employee_id = target) <> '33000000-0000-0000-0000-000000000002/d.jpg' then raise exception 'developer could not set a photo'; end if;
  perform public.set_avatar(target, null);
end $$;
reset role;

-- 6. CEOs / employees may read profile photos of others only as before (own row or CEO)
select pg_temp.as_user(:emp);
set role authenticated;
do $$ begin
  if (select count(*) from public.employee_profiles) > 1 then raise exception 'employee reads other people''s profiles'; end if;
end $$;
reset role;

-- 7. storage bucket + policies
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'avatars' and public and file_size_limit = 524288 and allowed_mime_types = array['image/jpeg']) then
    raise exception 'avatars bucket missing or misconfigured';
  end if;
end $$;

select pg_temp.as_user(:emp);
set role authenticated;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('avatars', '33000000-0000-0000-0000-000000000002/mine.jpg');
  begin insert into storage.objects (bucket_id, name) values ('avatars', '33000000-0000-0000-0000-000000000001/theirs.jpg'); raise exception 'uploaded into someone else''s folder';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('documents', '33000000-0000-0000-0000-000000000002/x.jpg'); raise exception 'wrong bucket accepted';
  exception when insufficient_privilege or foreign_key_violation then null; end;
end $$;
reset role;
insert into storage.objects (bucket_id, name) values ('avatars', '33000000-0000-0000-0000-000000000001/theirs.jpg');

select pg_temp.as_user(:emp);
set role authenticated;
do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'avatars') <> 1 then raise exception 'employee sees other people''s files'; end if;
  delete from storage.objects where name = '33000000-0000-0000-0000-000000000001/theirs.jpg';
  delete from storage.objects where name = '33000000-0000-0000-0000-000000000002/mine.jpg';
end $$;
reset role;
do $$ begin
  if not exists (select 1 from storage.objects where name = '33000000-0000-0000-0000-000000000001/theirs.jpg') then raise exception 'employee deleted someone else''s file'; end if;
  if exists (select 1 from storage.objects where name = '33000000-0000-0000-0000-000000000002/mine.jpg') then raise exception 'owner could not delete their file'; end if;
end $$;

select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('avatars', '33000000-0000-0000-0000-000000000002/ceo.jpg'); raise exception 'CEO uploaded into an employee folder';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('avatars', '33000000-0000-0000-0000-000000000002/dev.jpg');
  delete from storage.objects where name = '33000000-0000-0000-0000-000000000002/dev.jpg';
end $$;
reset role;

-- 8. anonymous callers
set role anon;
do $$ begin
  begin perform public.update_my_profile('A', 'B', null); raise exception 'anon can call update_my_profile';
  exception when insufficient_privilege then null; end;
  begin perform public.set_avatar(gen_random_uuid(), null); raise exception 'anon can call set_avatar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo 'PART 8 DB TESTS PASSED'
