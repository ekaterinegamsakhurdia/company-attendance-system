\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.headers', '{"x-forwarded-for":"198.51.100.1"}', false);
end $$;

\echo '--- part 7 checks start (audit scope)'
reset role;
\set ceo '''00000000-0000-0000-0000-0000000000c1'''
\set dev '''00000000-0000-0000-0000-0000000000f1'''
\set emp '''33000000-0000-0000-0000-000000000002'''
\set head '''33000000-0000-0000-0000-000000000001'''

delete from public.audit_logs;
insert into public.audit_logs (actor_user_id, employee_id, action, description) values
  (:ceo, null, 'employee.invite',        'ceo invites'),
  (:ceo, null, 'employee.delete',        'ceo deletes'),
  (:ceo, null, 'attendance.update',      'ceo corrects'),
  (:ceo, null, 'leave.approve',          'ceo approves a leave (routine)'),
  (:ceo, null, 'employee.dates',         'ceo edits dates (routine)'),
  (null, null, 'attendance.auto_clock_out', 'system (routine)'),
  (:dev, null, 'employee.invite',        'dev invites (important, but a developer entry)'),
  (:dev, null, 'employee.update',        'dev edits'),
  (:dev, null, 'leave.dev_update',       'dev edits a leave'),
  (:dev, null, 'webauthn.remove',        'dev removes a device');

select pg_temp.as_user(:ceo);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.audit_logs;
  if n <> 3 then raise exception 'CEO should see exactly the 3 important CEO entries, saw %', n; end if;
  if exists (select 1 from public.audit_logs where description like 'dev %') then raise exception 'CEO sees a developer entry'; end if;
  if exists (select 1 from public.audit_logs where description like '%routine%') then raise exception 'CEO sees routine noise'; end if;
  if not exists (select 1 from public.audit_logs where description = 'ceo corrects') then raise exception 'CEO misses a correction'; end if;
end $$;
reset role;

select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  if (select count(*) from public.audit_logs) <> 10 then raise exception 'developer should see all 10 entries, saw %', (select count(*) from public.audit_logs); end if;
end $$;
reset role;

select pg_temp.as_user(:emp);
set role authenticated;
do $$ begin
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'employee sees audit'; end if;
end $$;
reset role;
select pg_temp.as_user(:head);
set role authenticated;
do $$ begin
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'head sees audit'; end if;
  if public.audit_is_important('leave.request') then raise exception 'leave.request is not important'; end if;
  if not public.audit_is_important('employee.delete') then raise exception 'employee.delete is important'; end if;
  if not public.audit_is_important('employee.create') then raise exception 'employee.create is important'; end if;
end $$;
reset role;

-- unchanged: nobody can forge or change rows
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  begin insert into public.audit_logs(action) values ('forged'); raise exception 'forged insert allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.audit_logs; raise exception 'delete allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo 'PART 7 DB TESTS PASSED'
