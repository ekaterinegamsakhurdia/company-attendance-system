-- Reference snapshot of the schema BEFORE migration 20261007120000 (exported from Supabase).
-- For context only; not meant to be run. The migration in supabase/migrations is the source of truth for changes.
-- Note: indexes and ON DELETE rules are not included in this export.

CREATE TABLE public.departments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT departments_pkey PRIMARY KEY (id)
);
-- employees, attendance, audit_logs, company_settings: see supabase/tests/00_bootstrap.sql for the full definitions.
