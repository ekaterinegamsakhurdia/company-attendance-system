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

\echo '--- part 14 checks start (office floor plan)'
reset role;

\set ceo '''00000000-0000-0000-0000-0000000000c1'''
\set dev '''00000000-0000-0000-0000-0000000000f1'''
\set emp '''33000000-0000-0000-0000-000000000002'''

-- start from the original plan, with three departments the original rooms can recognise
select public.office_apply_default_layout();
delete from public.departments where name in ('Graphic Design', 'Account Management', 'Plan Lab', 'Plan Lab 2');
insert into public.departments (name) values ('Graphic Design'), ('Account Management'), ('Plan Lab'), ('Plan Lab 2');
select public.office_apply_default_layout();
delete from public.audit_logs;

-- ---- the original six rooms ----
do $$
declare n int;
begin
  select count(*) into n from public.office_rooms;
  if n <> 6 then raise exception 'the original plan has 6 rooms, found %', n; end if;
  if (select ceo_seat from public.office_rooms where name = 'CEO 1') <> 1 or (select ceo_seat from public.office_rooms where name = 'CEO 2') <> 2 then
    raise exception 'CEO rooms have the wrong seats';
  end if;
  if not (select department_ids @> array[(select id from public.departments where name = 'Graphic Design')] from public.office_rooms where name = 'Designers') then
    raise exception 'Designers should hold the Graphic Design department';
  end if;
  if not (select department_ids @> array[(select id from public.departments where name = 'Account Management')] from public.office_rooms where name = 'Account managers') then
    raise exception 'Account managers should hold the Account Management department';
  end if;
  if (select department_ids from public.office_rooms where name = 'Production') <> '{}' and
     exists (select 1 from public.departments d, public.office_rooms r where r.name = 'Production' and d.id = any (r.department_ids) and d.name !~* 'production') then
    raise exception 'Production holds a department that is not production';
  end if;
end $$;

-- ---- who can read, who can write ----
select pg_temp.as_user(:emp);
set role authenticated;
do $$ begin
  if (select count(*) from public.office_rooms) <> 6 then raise exception 'an employee should read the whole plan'; end if;
end $$;
select pg_temp.expect_error($$insert into public.office_rooms (name, x, y, w, h) values ('Mine', 0, 20, 2, 2)$$, 'permission denied');
select pg_temp.expect_error($$update public.office_rooms set name = 'Mine'$$, 'permission denied');
select pg_temp.expect_error($$delete from public.office_rooms$$, 'permission denied');
select pg_temp.expect_error($$select public.dev_save_office_layout('[]'::jsonb)$$, 'Only a developer');
select pg_temp.expect_error($$select public.dev_reset_office_layout()$$, 'Only a developer');
reset role;

select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if (select count(*) from public.office_rooms) <> 6 then raise exception 'a CEO should read the whole plan'; end if;
end $$;
select pg_temp.expect_error($$select public.dev_save_office_layout('[]'::jsonb)$$, 'Only a developer');
select pg_temp.expect_error($$select public.dev_reset_office_layout()$$, 'Only a developer');
reset role;

-- signed out: nothing at all
set role anon;
select pg_temp.expect_error($$select count(*) from public.office_rooms$$, 'permission denied');
reset role;
do $$ begin
  if (select count(*) from public.office_rooms) <> 6 then raise exception 'the plan changed without a developer'; end if;
end $$;

-- ---- the developer edits the plan ----
select pg_temp.as_user(:dev);
set role authenticated;

-- rejected plans leave the old plan in place
select pg_temp.expect_error($$select public.dev_save_office_layout('{"a":1}'::jsonb)$$, 'as a list');
select pg_temp.expect_error($$select public.dev_save_office_layout('[{"name":"  ","x":0,"y":0,"w":2,"h":2}]'::jsonb)$$, 'needs a name');
select pg_temp.expect_error($$select public.dev_save_office_layout('[{"name":"Too wide","x":8,"y":0,"w":5,"h":2}]'::jsonb)$$, 'does not fit');
select pg_temp.expect_error($$select public.dev_save_office_layout('[{"name":"Too low","x":0,"y":39,"w":2,"h":2}]'::jsonb)$$, 'does not fit');
select pg_temp.expect_error($$select public.dev_save_office_layout('[{"name":"Negative","x":-1,"y":0,"w":2,"h":2}]'::jsonb)$$, 'does not fit');
select pg_temp.expect_error($$select public.dev_save_office_layout('[{"name":"Flat","x":0,"y":0,"w":2,"h":0}]'::jsonb)$$, 'does not fit');
select pg_temp.expect_error($$select public.dev_save_office_layout(jsonb_build_array(jsonb_build_object('name', repeat('x', 41), 'x', 0, 'y', 0, 'w', 2, 'h', 2)))$$, 'longer than 40');
select pg_temp.expect_error($$select public.dev_save_office_layout('[{"name":"A","x":0,"y":0,"w":4,"h":4},{"name":"B","x":3,"y":3,"w":4,"h":4}]'::jsonb)$$, 'overlap');
select pg_temp.expect_error($$select public.dev_save_office_layout('[{"name":"A","x":0,"y":0,"w":4,"h":4,"ceo_seat":1},{"name":"B","x":4,"y":0,"w":4,"h":4,"ceo_seat":1}]'::jsonb)$$, 'CEO seat cannot be in two rooms');
select pg_temp.expect_error($$select public.dev_save_office_layout('[{"name":"A","x":0,"y":0,"w":4,"h":4,"ceo_seat":10}]'::jsonb)$$, 'between 1 and 9');
select pg_temp.expect_error($$select public.dev_save_office_layout(jsonb_build_array(
  jsonb_build_object('name', 'A', 'x', 0, 'y', 0, 'w', 4, 'h', 4, 'department_ids', jsonb_build_array((select id from public.departments where name = 'Plan Lab'))),
  jsonb_build_object('name', 'B', 'x', 4, 'y', 0, 'w', 4, 'h', 4, 'department_ids', jsonb_build_array((select id from public.departments where name = 'Plan Lab')))))$$, 'cannot be in two rooms');
select pg_temp.expect_error($$select public.dev_save_office_layout(jsonb_build_array(jsonb_build_object('name', 'A', 'x', 0, 'y', 0, 'w', 4, 'h', 4, 'department_ids', jsonb_build_array(gen_random_uuid()))))$$, 'no longer exists');
select pg_temp.expect_error($$select public.dev_save_office_layout((select jsonb_agg(jsonb_build_object('name', 'R' || g, 'x', 0, 'y', 0, 'w', 1, 'h', 1)) from generate_series(1, 41) g))$$, 'at most 40');
select pg_temp.expect_error($$select public.dev_save_office_layout(jsonb_build_array(
  jsonb_build_object('id', '99000000-0000-0000-0000-000000000001', 'name', 'A', 'x', 0, 'y', 0, 'w', 2, 'h', 2),
  jsonb_build_object('id', '99000000-0000-0000-0000-000000000001', 'name', 'B', 'x', 2, 'y', 0, 'w', 2, 'h', 2)))$$, 'twice');
do $$ begin
  if (select count(*) from public.office_rooms) <> 6 or not exists (select 1 from public.office_rooms where name = 'Designers') then
    raise exception 'a refused plan must leave the old plan untouched';
  end if;
end $$;

-- a good plan: rename, move, resize, add a plain room, drop two rooms, keep an id
do $$
declare
  keep uuid := (select id from public.office_rooms where name = 'Production');
  lab uuid := (select id from public.departments where name = 'Plan Lab');
  saved integer;
begin
  select count(*) into saved from public.dev_save_office_layout(jsonb_build_array(
    jsonb_build_object('id', keep, 'name', ' Studio ', 'x', 1, 'y', 2, 'w', 5, 'h', 3, 'department_ids', jsonb_build_array(lab)),
    jsonb_build_object('name', 'Kitchen', 'x', 6, 'y', 2, 'w', 2, 'h', 2),
    jsonb_build_object('name', 'Boss', 'x', 8, 'y', 0, 'w', 3, 'h', 2, 'ceo_seat', 1),
    -- touching rooms are not overlapping
    jsonb_build_object('name', 'Next door', 'x', 6, 'y', 4, 'w', 6, 'h', 1)));
  if saved <> 4 then raise exception 'saved plan should have 4 rooms, has %', saved; end if;
  if (select count(*) from public.office_rooms) <> 4 then raise exception 'rooms not replaced'; end if;
  if not exists (select 1 from public.office_rooms where id = keep and name = 'Studio' and x = 1 and y = 2 and w = 5 and h = 3 and department_ids = array[lab]) then
    raise exception 'the kept room lost its id, name (trimmed), place, size or department';
  end if;
  if (select count(*) from public.office_rooms where id <> keep and id is not null) <> 3 then raise exception 'new rooms need ids'; end if;
  if exists (select 1 from public.office_rooms where name = 'Designers') then raise exception 'dropped room is still there'; end if;
  if (select ceo_seat from public.office_rooms where name = 'Boss') <> 1 then raise exception 'ceo seat lost'; end if;
end $$;
reset role;

-- audited, with the old and the new plan, and visible to the developer only
do $$
declare a public.audit_logs;
begin
  select * into a from public.audit_logs where action = 'office.layout';
  if a.id is null then raise exception 'saving the plan was not audited'; end if;
  if a.actor_user_id <> '00000000-0000-0000-0000-0000000000f1' then raise exception 'wrong actor'; end if;
  if jsonb_array_length(a.metadata->'old') <> 6 or jsonb_array_length(a.metadata->'new') <> 4 then raise exception 'audit must hold the old (6) and new (4) plan'; end if;
end $$;
select pg_temp.as_user(:ceo);
set role authenticated;
do $$ begin
  if exists (select 1 from public.audit_logs where action like 'office.%') then raise exception 'a CEO must not see developer plan edits'; end if;
end $$;
reset role;

-- an empty plan is allowed (everything removed), and a plan can be saved again over itself
select pg_temp.as_user(:dev);
set role authenticated;
do $$ begin
  perform public.dev_save_office_layout('[]'::jsonb);
  if (select count(*) from public.office_rooms) <> 0 then raise exception 'empty plan not saved'; end if;
  perform public.dev_save_office_layout(jsonb_build_array(jsonb_build_object('name', 'Solo', 'x', 0, 'y', 0, 'w', 12, 'h', 40, 'department_ids', jsonb_build_array((select id from public.departments where name = 'Plan Lab 2')))));
  perform public.dev_save_office_layout(jsonb_build_array(jsonb_build_object('name', 'Solo', 'x', 0, 'y', 0, 'w', 12, 'h', 40)));
  if (select count(*) from public.office_rooms) <> 1 then raise exception 'second save should still have one room'; end if;
end $$;
reset role;

-- deleting a department takes it out of its room, the room stays
do $$
declare lab2 uuid := (select id from public.departments where name = 'Plan Lab 2');
begin
  update public.office_rooms set department_ids = array[lab2];
  delete from public.departments where id = lab2;
  if (select department_ids from public.office_rooms where name = 'Solo') <> '{}' then raise exception 'deleted department is still in its room'; end if;
  if (select count(*) from public.office_rooms) <> 1 then raise exception 'the room must stay'; end if;
end $$;

-- the original plan comes back, by a developer only, audited
delete from public.audit_logs;
select pg_temp.as_user(:dev);
set role authenticated;
do $$ declare n integer; begin
  select count(*) into n from public.dev_reset_office_layout();
  if n <> 6 then raise exception 'reset should give 6 rooms, gave %', n; end if;
  if not exists (select 1 from public.office_rooms where name = 'Designers' and x = 0 and y = 0 and w = 4 and h = 4) then raise exception 'Designers missing after reset'; end if;
  if not exists (select 1 from public.office_rooms where name = 'CEO 2' and ceo_seat = 2) then raise exception 'CEO 2 missing after reset'; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.audit_logs where action = 'office.layout_reset' and jsonb_array_length(metadata->'old') = 1) then
    raise exception 'reset was not audited with the old plan';
  end if;
end $$;

-- rooms never overlap, even if something bypasses the function (the table itself refuses)
do $$ begin
  begin
    insert into public.office_rooms (name, x, y, w, h) values ('Squatter', 1, 1, 3, 3);
    raise exception 'overlap went through the table';
  exception when exclusion_violation then null; end;
end $$;
\echo 'OFFICE FLOOR PLAN OK'

-- if Supabase's "requires a WHERE clause" guard (SQLSTATE 21000) ever fires inside a save, the error says where
reset role;
create or replace function pg_temp.guard_probe() returns trigger language plpgsql as $$
begin raise exception 'DELETE requires a WHERE clause' using errcode = '21000'; end $$;
create trigger zz_guard_probe before insert on public.office_rooms for each row execute function pg_temp.guard_probe();
select pg_temp.as_user(:dev);
set role authenticated;
select pg_temp.expect_error($$select public.dev_save_office_layout('[{"name":"A","x":0,"y":0,"w":4,"h":4}]'::jsonb)$$, '(where:');
reset role;
drop trigger zz_guard_probe on public.office_rooms;
do $$ begin
  if (select count(*) from public.office_rooms) <> 6 then raise exception 'a failed save must leave the plan untouched (still the original six)'; end if;
end $$;
\echo 'OFFICE FLOOR PLAN DIAGNOSTICS OK'
