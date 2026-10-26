-- =====================================================================
-- Looper Agency, migration 8: profile photos and self-service profile
--
--   * employee_profiles.avatar_path: the profile photo (a file in the public
--     "avatars" storage bucket, folder = the person's login id).
--   * update_my_profile(): everyone may change their OWN first name, last name
--     and birth date. Nothing else (number, e-mail, department, role, hours,
--     approver, start date ...) can be changed this way.
--   * set_avatar(): the person themself, or a developer for anyone, sets or
--     removes the photo.
--   * Storage: bucket "avatars" (public read by the unguessable file name, JPEG
--     only, max 512 KB) and policies so people can only write inside their own
--     folder (a developer in any folder).
--
-- Safe to run more than once, on a database that has migrations 1-7.
-- =====================================================================

begin;

alter table public.employee_profiles
  add column if not exists avatar_path text check (avatar_path is null or length(avatar_path) <= 200);

-- ---------------------------------------------------------------------
-- Own name and birth date
-- ---------------------------------------------------------------------
create or replace function public.update_my_profile(
  p_first_name text,
  p_last_name  text,
  p_birth_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      public.employees;
  v_first text := regexp_replace(trim(coalesce(p_first_name, '')), '\s+', ' ', 'g');
  v_last  text := regexp_replace(trim(coalesce(p_last_name,  '')), '\s+', ' ', 'g');
  old_birth date;
begin
  select * into me from public.employees where auth_user_id = auth.uid() and is_active;
  if not found then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;
  if length(v_first) not between 1 and 100 then
    raise exception 'First name must be 1 to 100 characters.' using errcode = '22023';
  end if;
  if length(v_last) not between 1 and 100 then
    raise exception 'Last name must be 1 to 100 characters.' using errcode = '22023';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > public.company_today()) then
    raise exception 'Birth date must be a real date in the past.' using errcode = '22023';
  end if;

  select birth_date into old_birth from public.employee_profiles where employee_id = me.id;

  if v_first is distinct from me.first_name or v_last is distinct from me.last_name then
    update public.employees set first_name = v_first, last_name = v_last where id = me.id;
  end if;
  insert into public.employee_profiles (employee_id, birth_date)
  values (me.id, p_birth_date)
  on conflict (employee_id) do update set birth_date = excluded.birth_date;

  perform public.log_audit('employee.self_update', me.id, 'Changed their own name / birth date',
    jsonb_build_object('old_name', me.first_name || ' ' || me.last_name, 'new_name', v_first || ' ' || v_last,
                       'old_birth', old_birth, 'new_birth', p_birth_date));
end;
$$;

revoke all on function public.update_my_profile(text, text, date) from public, anon;
grant execute on function public.update_my_profile(text, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- Profile photo
-- ---------------------------------------------------------------------
create or replace function public.set_avatar(p_employee_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := public.current_employee_id();
  target public.employees;
begin
  if me is null then
    raise exception 'No active employee profile for this account.' using errcode = 'P0001';
  end if;
  select * into target from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_employee_id is distinct from me and not public.is_developer() then
    raise exception 'You can only change your own photo.' using errcode = '42501';
  end if;
  if p_path is not null and (
       target.auth_user_id is null
       or length(p_path) > 200
       or position('..' in p_path) > 0
       or p_path not like target.auth_user_id::text || '/%') then
    raise exception 'Invalid photo.' using errcode = '22023';
  end if;

  insert into public.employee_profiles (employee_id, avatar_path)
  values (p_employee_id, p_path)
  on conflict (employee_id) do update set avatar_path = excluded.avatar_path;

  perform public.log_audit('employee.avatar', p_employee_id,
    case when p_path is null then 'Profile photo removed' else 'Profile photo changed' end, null);
end;
$$;

revoke all on function public.set_avatar(uuid, text) from public, anon;
grant execute on function public.set_avatar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Storage bucket + policies (skipped on a database without Supabase Storage)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Supabase Storage is not available here; the avatars bucket was not created.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 524288, array['image/jpeg'])
  on conflict (id) do update
     set public = true, file_size_limit = 524288, allowed_mime_types = array['image/jpeg'];

  execute 'drop policy if exists avatars_select on storage.objects';
  execute 'drop policy if exists avatars_insert on storage.objects';
  execute 'drop policy if exists avatars_update on storage.objects';
  execute 'drop policy if exists avatars_delete on storage.objects';

  execute $p$create policy avatars_select on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_developer()))$p$;
  execute $p$create policy avatars_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_developer()))$p$;
  execute $p$create policy avatars_update on storage.objects for update to authenticated
    using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_developer()))
    with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_developer()))$p$;
  execute $p$create policy avatars_delete on storage.objects for delete to authenticated
    using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_developer()))$p$;
end $$;

commit;
