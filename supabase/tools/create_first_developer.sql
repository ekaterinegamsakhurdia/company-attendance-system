-- Creates (or promotes) the FIRST developer account.
-- Run it once in the Supabase SQL editor, after applying migration 20261008120000_developer_role.sql.
--
-- Before running:
--   1. Create the login: Dashboard -> Authentication -> Users -> "Add user" -> "Create new user",
--      enter the developer's email + a password and tick "Auto Confirm User".
--   2. Change the four values below (use an email that is NOT the CEO's).
--
-- After that the developer logs in with that email + password and lands on the Developer Dashboard.
-- Further developers and CEOs are added from there ("Accounts" -> "Add Account").

do $$
declare
  v_email  text := 'you@example.com';   -- <-- the developer's login email
  v_first  text := 'Your';              -- <-- first name
  v_last   text := 'Name';              -- <-- last name
  v_number text := 'DEV001';            -- <-- employee number (must be unused)
  v_uid    uuid;
  v_emp    uuid;
  v_role   text;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'No login with the email % exists yet. Create it first (Authentication -> Users -> Add user), then run this again.', v_email;
  end if;

  select id, role into v_emp, v_role
  from public.employees
  where auth_user_id = v_uid or lower(email) = lower(v_email)
  limit 1;

  -- Never turn the only CEO into a developer by accident.
  if v_role = 'ceo'
     and not exists (select 1 from public.employees where role = 'ceo' and is_active and id <> v_emp) then
    raise exception '% is the only active CEO. Use a different email for the developer account.', v_email;
  end if;

  if v_emp is null then
    insert into public.employees (auth_user_id, employee_number, first_name, last_name, email, role, is_active)
    values (v_uid, trim(v_number), trim(v_first), trim(v_last), lower(trim(v_email)), 'developer', true)
    returning id into v_emp;
  else
    update public.employees
       set auth_user_id = v_uid, role = 'developer', department_id = null, job_role_id = null, is_active = true
     where id = v_emp;
  end if;

  insert into public.audit_logs (action, employee_id, description, metadata)
  values ('employee.role', v_emp, 'Developer account created from the SQL editor',
          jsonb_build_object('new_role', 'developer', 'email', lower(v_email)));

  raise notice 'Done: % is now a developer.', v_email;
end $$;
