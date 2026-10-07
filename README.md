# Looper Agency – Attendance

Employee attendance tracker. React 19 + Vite on the front end, Supabase (Postgres, Auth, Edge Functions) as the backend.

**Roles:** `employee` (clock in/out, own history), **department head** (an employee who also gets a read-only view of their own department) and `ceo` (everything below).

**Departments:** Advertising, Account Managers, Production, Copywriting, Design. Each has one head and employees. Production employees also have a **job role**: Montage, Operator or Motion Designer.

| CEO tab | What it does |
|---|---|
| Today | Team status for today, the CEO's own clock-in/out |
| Reports | Date-range / department / employee report, CSV export, correct or add records (reason required, audited) |
| Employees | Add + invite, resend invitation, department, job role, registered devices, delete |
| Settings | Company name, time zone, work hours, **clock-in security**, **company networks**, department heads, job roles |
| Audit Log | Who changed what, with reasons |

A department head sees an extra **"<Department> team"** tab: today's status and a date-range report/CSV for their own department only. They cannot edit anything.

### Clock-in security

Two switches in **Settings → Clock-in Security** (both **off** after the migration so nobody is locked out):

1. **Require the company network.** Clock in/out is refused unless the request comes from an IP the CEO listed under *Company Networks*. Logging in and viewing history work from anywhere. The CEO can add the network they are on with one click.
2. **Require Face ID / fingerprint.** Every clock-in and clock-out needs a fresh check on a registered device (WebAuthn / passkey). The employee registers a phone or laptop once (re-entering their password), max 3 devices; the CEO can remove devices.

Together with email + password at login, that is the full clock-in path: password → company network → Face ID / fingerprint. The CEO is held to the same rules.

## How it is secured

* The browser can only **read**. Row Level Security lets employees read their own rows and the CEO read everything; there are no client write policies on `employees`, `attendance` or `audit_logs`.
* Clock-in/out go through the `clock_in()` / `clock_out()` database functions: **time, work date, worked minutes and IP come from the server**, never from the browser.
* Corrections go through `ceo_save_attendance` / `ceo_delete_attendance`, which require a reason and write to `audit_logs`.
* Creating, inviting and deleting employees happens in Edge Functions that verify the caller's JWT **and** that they are an active CEO (`supabase/functions/_shared/common.ts`).
* Employee deletion order is deactivate → delete login → delete row, so a failure at any step is retryable and never leaves a working login behind. Attendance history is kept, with the employee's name snapshotted on each row.
* The network rule is enforced **in the database** (`assert_clock_allowed`), using only the `cf-connecting-ip` header that Supabase's edge sets. The spoofable `x-forwarded-for` is ignored and the check fails closed if the header is missing.
* The biometric check is a WebAuthn step-up: the `webauthn` Edge Function verifies the signed challenge and issues a one-time token (valid 2 minutes) that `clock_in(p_verification)` / `clock_out(p_verification)` consume. Skipping the function does not help, the database refuses without the token.
* Forgotten shifts are closed automatically at the company's work-end time (`auto_clock_out()`, scheduled with pg_cron every 10 minutes).

## Setup

```bash
npm ci
cp .env.example .env.local        # fill in URL + publishable key
npm run dev
```

### Database

1. (Optional) review current policies: `select * from pg_policies where schemaname = 'public';`
2. Apply the migrations in order (`supabase db push`, or paste into the SQL editor):
   1. `20261007120000_hardening_and_features.sql`, **drops all existing policies on the app tables and replaces them.**
   2. `20261007180000_org_structure_network_biometric.sql`, departments seed (Advertising, Account Managers, Production, Copywriting, Design), production job roles, department heads, allowed networks, WebAuthn tables, network/biometric enforcement. An existing `company_public_ip` is carried over into the network list.
3. If the migration prints `pg_cron is not available`, enable the *pg_cron* extension in the dashboard and run:
   `select cron.schedule('auto-clock-out', '*/10 * * * *', 'select public.auto_clock_out()');`
4. Check Dashboard → Authentication → URL Configuration: the Site URL and redirect list must include `https://YOUR-SITE/set-password`.

### Edge Functions

```bash
supabase secrets set SITE_URL=https://your-site.example     # used for invitation links AND as the CORS origin
# optional: ALLOWED_ORIGINS=https://your-site.example,http://localhost:5173
supabase functions deploy invite-employee
supabase functions deploy delete-employee
supabase functions deploy webauthn
```

`SITE_URL` is required: the invite function refuses to run without it instead of falling back to localhost.

**Face ID / fingerprint needs HTTPS** (or `localhost`). The relying-party ID defaults to the hostname of `SITE_URL`; set `WEBAUTHN_RP_ID` only if you serve the app from a subdomain and want one registration to cover the parent domain. Changing the domain later invalidates registered devices.

### Rollout checklist

1. Apply migration 2 and deploy the `webauthn` function. Nothing changes for employees yet.
2. As CEO open the **Employees** tab and set each person's department and (for Production) job role, then pick the five department heads under **Settings**.
3. **Settings → Company Networks:** while on the office wifi press *Add my current network*. Check that the shown IP is the office's public IP.
4. Turn on **Require the company network** and test a clock-in from the office and from a phone on mobile data (it must be refused).
5. Ask employees to open the app on their phone and register it (**My Devices → Register this device**), then turn on **Require Face ID / fingerprint**.

## Tests

```bash
npm run lint
npm test                              # time-zone + CSV helpers
npm run build

# Database (needs a throw-away Postgres 14+; never run against production)
PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh
```

The database tests build a mock of Supabase's `auth` schema, apply both migrations and assert RLS, department-head scope, job-role integrity, network enforcement (including spoofed headers), one-time biometric tokens, server-side time, corrections, audit entries, auto clock-out (including overnight shifts) and the delete order.

CI (`.github/workflows/ci.yml`) runs lint, unit tests, build, the database tests on Postgres 16 and `deno check` on all three Edge Functions.

## Project layout

```
src/
  services/    supabase client + api.js (all queries / RPC / function calls)
  hooks/       useAuth (session, profile, settings), useLoad, useMyAttendance
  components/  ui primitives, Toast, Modal/ConfirmDialog, AttendancePanel, DevicesCard, TeamOverview
  views/       Login, SetPassword, EmployeeDashboard, HeadTeam, CeoDashboard, ceo/* tabs
  lib/         time (company time-zone helpers), csv, biometric (WebAuthn in the browser)
supabase/
  migrations/  schema hardening + features
  functions/   invite-employee, delete-employee, webauthn, _shared
  tests/       SQL tests
```

## Known limits / ideas

* **The biometric check cannot prove "face" or "fingerprint" specifically.** WebAuthn only tells the server that the device's owner verified themselves (`userVerification: required`); on some phones that can be the device PIN. It does prove a registered device was physically unlocked at that moment.
* **IPv6:** a network is stored as the /64 prefix, IPv4 as a single address. If the office has a changing public IP, re-add it (or ask the ISP for a fixed one).
* **Verify `cf-connecting-ip`** on your project once (the *Add my current network* button shows the IP the server sees) before turning the network rule on. If the header is ever absent, clock-in is refused, not allowed.
* A VPN or phone hotspot that exits through the office network would pass the network rule; the rule limits location, it is not a proof of presence.
* Department heads are read-only. Letting them correct records would be a small addition to the RPCs plus a UI change.
* One record per employee per work date (split shifts are not supported).
* No rate limiting on the Edge Functions beyond Supabase's defaults.
