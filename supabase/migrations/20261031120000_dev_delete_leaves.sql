-- =====================================================================
-- Looper Agency, migration 13: developers can delete several leaves at once
--
--   dev_delete_leaves(ids): developer only. Deletes up to 500 leave requests in one
--   go (the Leaves tab lets a developer tick rows). Every deleted leave gets its own
--   audit entry ("leave.delete"), exactly like deleting one at a time. Ids that no
--   longer exist are ignored; the result is the number of leaves really deleted.
--
-- Safe to run more than once, on a database that has migrations 1-12.
-- =====================================================================

begin;

create or replace function public.dev_delete_leaves(p_leave_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leave_requests;
  n integer := 0;
  one_id uuid;
begin
  if not public.is_developer() then
    raise exception 'Only a developer can do this.' using errcode = '42501';
  end if;
  if p_leave_ids is null or cardinality(p_leave_ids) = 0 then
    raise exception 'Choose at least one leave.' using errcode = '22023';
  end if;
  if cardinality(p_leave_ids) > 500 then
    raise exception 'Delete at most 500 leaves at a time.' using errcode = '22023';
  end if;

  for one_id in select distinct x from unnest(p_leave_ids) as x loop
    delete from public.leave_requests where id = one_id returning * into r;
    if found then
      n := n + 1;
      perform public.log_audit('leave.delete', r.employee_id,
        'Developer deleted ' || public.leave_category_label(r.category) || ' ' || r.start_date || ' to ' || r.end_date,
        jsonb_build_object('leave_id', r.id, 'old', to_jsonb(r), 'bulk', true));
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.dev_delete_leaves(uuid[]) from public, anon;
grant execute on function public.dev_delete_leaves(uuid[]) to authenticated;

commit;
