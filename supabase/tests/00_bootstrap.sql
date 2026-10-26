-- Minimal stand-in for Supabase's auth schema + roles, for local testing only.
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- Minimal stand-in for Supabase Storage (buckets, objects, foldername) so the avatar policies can be tested.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid default auth.uid(),
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(coalesce(array_length(string_to_array(name, '/'), 1), 1) - 1, 0)]
$$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

CREATE TABLE public.departments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT departments_pkey PRIMARY KEY (id)
);
CREATE TABLE public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE,
  employee_number text NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text UNIQUE,
  department_id uuid,
  role text NOT NULL DEFAULT 'employee'::text CHECK (role = ANY (ARRAY['employee'::text, 'ceo'::text])),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT employees_pkey PRIMARY KEY (id),
  CONSTRAINT employees_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id),
  CONSTRAINT employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id)
);
CREATE TABLE public.attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid,
  work_date date NOT NULL,
  clock_in timestamp with time zone NOT NULL,
  clock_out timestamp with time zone,
  clock_in_ip inet,
  clock_out_ip inet,
  clockout_type text CHECK (clockout_type = ANY (ARRAY['manual'::text, 'automatic'::text])),
  worked_minutes integer CHECK (worked_minutes IS NULL OR worked_minutes >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT attendance_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  employee_id uuid,
  action text NOT NULL,
  description text,
  ip_address inet,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id),
  CONSTRAINT audit_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE TABLE public.company_settings (
  id integer NOT NULL DEFAULT 1 CHECK (id = 1),
  company_name text NOT NULL DEFAULT 'Looper Agency'::text,
  work_start_time time without time zone NOT NULL DEFAULT '11:00:00'::time without time zone,
  work_end_time time without time zone NOT NULL DEFAULT '19:00:00'::time without time zone,
  timezone text NOT NULL DEFAULT 'Asia/Tbilisi'::text,
  company_public_ip inet,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT company_settings_pkey PRIMARY KEY (id)
);

-- A permissive "legacy" policy the migration must wipe out
alter table public.attendance enable row level security;
create policy legacy_all on public.attendance for all to authenticated using (true) with check (true);

-- Seed: one CEO, two employees (one with pre-existing history)
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000c1','ceo@x.test'),
 ('00000000-0000-0000-0000-0000000000a1','alice@x.test'),
 ('00000000-0000-0000-0000-0000000000b1','bob@x.test');
insert into public.employees (id, auth_user_id, employee_number, first_name, last_name, email, role) values
 ('10000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c1','EMP001','Cee','Oh','ceo@x.test','ceo'),
 ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','EMP002','Alice','A','alice@x.test','employee'),
 ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1','EMP003','Bob','B','bob@x.test','employee');
insert into public.attendance (employee_id, work_date, clock_in, clock_out, clockout_type, worked_minutes) values
 ('10000000-0000-0000-0000-0000000000b1', '2026-10-01', '2026-10-01 07:00+00', '2026-10-01 15:00+00', 'manual', 480);

-- Legacy function with a different return type, as found in the real project:
-- the migrations must be able to replace it (CREATE OR REPLACE cannot change a return type).
create or replace function public.auto_clock_out() returns void language sql as $$ select 1 $$;
