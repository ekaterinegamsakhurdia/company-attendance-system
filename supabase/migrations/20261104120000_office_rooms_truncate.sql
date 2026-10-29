-- =====================================================================
-- Looper Agency, migration 17: floor plan saves without any DELETE statement
--
--   Saving or restoring the floor plan still failed on Supabase with "DELETE requires a WHERE clause".
--   The plan is now cleared with TRUNCATE, which Supabase's guard does not apply to. If that guard ever
--   fires inside these two functions again, the error now says which statement and function raised it
--   ("... (where: SQL statement ... | PL/pgSQL function ... line N ...)") instead of just the guard's message.
--
-- Safe to run more than once, on a database that has migrations 1-16.
-- =====================================================================

begin;

create or replace function public.office_apply_default_layout()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  truncate public.office_rooms;  -- not a DELETE, so Supabase's "DELETE requires a WHERE clause" guard never applies
  insert into public.office_rooms (name, x, y, w, h, department_ids, ceo_seat)
  select r.name, r.x, r.y, r.w, r.h,
         coalesce((select array_agg(d.id order by d.name) from public.departments d
                   where (case when d.name ~* 'design' then 'design'
                               when d.name ~* 'production' then 'production'
                               when d.name ~* 'account' then 'accounts'
                               when d.name ~* 'copy' then 'copy' end) = r.area), '{}'),
         r.seat
  from (values
    ('design',     'Designers',        0, 0, 4, 4, null::smallint),
    ('accounts',   'Account managers', 4, 0, 4, 8, null),
    ('copy',       'Copywriters',      8, 0, 4, 4, null),
    ('production','Production',        0, 4, 4, 4, null),
    ('ceo2',       'CEO 2',            8, 4, 4, 2, 2),
    ('ceo1',       'CEO 1',            8, 6, 4, 2, 1)
  ) as r(area, name, x, y, w, h, seat);
end;
$$;

revoke all on function public.office_apply_default_layout() from public, anon, authenticated;

create or replace function public.dev_save_office_layout(p_rooms jsonb)
returns setof public.office_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx text;
  r record;
  o record;
  before_rooms jsonb;
  n integer;
begin
  if not public.is_developer() then
    raise exception 'Only a developer can do this.' using errcode = '42501';
  end if;
  if p_rooms is null or jsonb_typeof(p_rooms) <> 'array' then
    raise exception 'Send the rooms as a list.' using errcode = '22023';
  end if;
  n := jsonb_array_length(p_rooms);
  if n > 40 then
    raise exception 'A floor plan can have at most 40 rooms.' using errcode = '22023';
  end if;

  create temporary table if not exists pg_temp.incoming_rooms (
    id uuid, name text, x integer, y integer, w integer, h integer, department_ids uuid[], ceo_seat integer
  ) on commit drop;
  truncate pg_temp.incoming_rooms;

  insert into pg_temp.incoming_rooms
  select t.id, btrim(t.name), t.x, t.y, t.w, t.h, coalesce(t.department_ids, '{}'), t.ceo_seat
  from jsonb_to_recordset(p_rooms) as t(id uuid, name text, x integer, y integer, w integer, h integer, department_ids uuid[], ceo_seat integer);

  for r in select * from pg_temp.incoming_rooms loop
    if r.name is null or char_length(r.name) = 0 then
      raise exception 'Every room needs a name.' using errcode = '22023';
    end if;
    if char_length(r.name) > 40 then
      raise exception 'The room name "%" is longer than 40 characters.', left(r.name, 20) using errcode = '22023';
    end if;
    if r.x is null or r.y is null or r.w is null or r.h is null
       or r.x < 0 or r.y < 0 or r.w < 1 or r.h < 1 or r.x + r.w > 12 or r.y + r.h > 40 then
      raise exception '"%" does not fit on the floor (12 columns, 40 rows).', r.name using errcode = '22023';
    end if;
    if r.ceo_seat is not null and r.ceo_seat not between 1 and 9 then
      raise exception 'CEO seat must be between 1 and 9.' using errcode = '22023';
    end if;
  end loop;

  if (select count(distinct id) from pg_temp.incoming_rooms where id is not null)
     <> (select count(id) from pg_temp.incoming_rooms) then
    raise exception 'The same room was sent twice.' using errcode = '22023';
  end if;

  if exists (
    select 1 from pg_temp.incoming_rooms i, unnest(i.department_ids) as did
    where not exists (select 1 from public.departments d where d.id = did)
  ) then
    raise exception 'A department in the plan no longer exists. Reload and try again.' using errcode = '22023';
  end if;

  select i1.name as a, i2.name as b into o
  from pg_temp.incoming_rooms i1
  join pg_temp.incoming_rooms i2
    on i1.ctid < i2.ctid and i1.department_ids && i2.department_ids
  limit 1;
  if found then
    raise exception 'A department cannot be in two rooms ("%" and "%").', o.a, o.b using errcode = '22023';
  end if;

  select i1.name as a, i2.name as b into o
  from pg_temp.incoming_rooms i1
  join pg_temp.incoming_rooms i2
    on i1.ctid < i2.ctid and i1.ceo_seat is not null and i1.ceo_seat = i2.ceo_seat
  limit 1;
  if found then
    raise exception 'A CEO seat cannot be in two rooms ("%" and "%").', o.a, o.b using errcode = '22023';
  end if;

  select i1.name as a, i2.name as b into o
  from pg_temp.incoming_rooms i1
  join pg_temp.incoming_rooms i2
    on i1.ctid < i2.ctid
   and i1.x < i2.x + i2.w and i2.x < i1.x + i1.w
   and i1.y < i2.y + i2.h and i2.y < i1.y + i1.h
  limit 1;
  if found then
    raise exception 'The rooms "%" and "%" overlap.', o.a, o.b using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.y, x.x), '[]'::jsonb) into before_rooms
  from (select id, name, x, y, w, h, department_ids, ceo_seat from public.office_rooms) x;

  truncate public.office_rooms;  -- not a DELETE, so Supabase's "DELETE requires a WHERE clause" guard never applies
  insert into public.office_rooms (id, name, x, y, w, h, department_ids, ceo_seat)
  select coalesce(i.id, gen_random_uuid()), i.name, i.x, i.y, i.w, i.h, i.department_ids, i.ceo_seat
  from pg_temp.incoming_rooms i;

  perform public.log_audit('office.layout', null,
    'Developer changed the office floor plan (' || n || case when n = 1 then ' room)' else ' rooms)' end,
    jsonb_build_object('old', before_rooms, 'new', p_rooms));

  return query select * from public.office_rooms order by y, x, name;
exception
  when cardinality_violation then
    -- Supabase's "DELETE/UPDATE requires a WHERE clause" guard: say which statement caused it
    get stacked diagnostics ctx = pg_exception_context;
    raise exception '% (where: %)', sqlerrm, replace(ctx, E'\n', ' | ') using errcode = '21000';
end;
$$;

revoke all on function public.dev_save_office_layout(jsonb) from public, anon;
grant execute on function public.dev_save_office_layout(jsonb) to authenticated;

create or replace function public.dev_reset_office_layout()
returns setof public.office_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx text;
  before_rooms jsonb;
begin
  if not public.is_developer() then
    raise exception 'Only a developer can do this.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.y, x.x), '[]'::jsonb) into before_rooms
  from (select id, name, x, y, w, h, department_ids, ceo_seat from public.office_rooms) x;

  perform public.office_apply_default_layout();

  perform public.log_audit('office.layout_reset', null,
    'Developer restored the original office floor plan', jsonb_build_object('old', before_rooms));

  return query select * from public.office_rooms order by y, x, name;
exception
  when cardinality_violation then
    -- Supabase's "DELETE/UPDATE requires a WHERE clause" guard: say which statement caused it
    get stacked diagnostics ctx = pg_exception_context;
    raise exception '% (where: %)', sqlerrm, replace(ctx, E'\n', ' | ') using errcode = '21000';
end;
$$;

revoke all on function public.dev_reset_office_layout() from public, anon;
grant execute on function public.dev_reset_office_layout() to authenticated;

commit;
