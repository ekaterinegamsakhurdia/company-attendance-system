# Looper Agency – Attendance

Employee attendance tracker. React 19 + Vite on the front end, Supabase (Postgres, Auth, Edge Functions) as the backend.

**Roles:** `employee` (clock in/out, own history, own leaves and the calendar), **department head** (an employee who also gets a read-only view of their own department and decides their department's leave requests), `ceo` (everything below) and `developer` (everything the CEO can do, plus account management and editing any data, see *Developer account*).

**Departments:** Advertising, Account Managers, Production, Copywriting, Design. Each has one head and employees. Production employees also have a **job role**: Montage, Operator or Motion Designer.

| CEO tab | What it does |
|---|---|
| Today | Team status for today (CEOs and developers included), the CEO's own clock-in/out |
| Leaves | Requests waiting for a decision (approve / reject with a note), every request of the year with filters, cancel with a reason; a developer can also add, edit, delete one leave, or tick several (or all shown) and delete them together |
| Calendar | **Month** view (public holidays, everyone's leaves, birthdays and work anniversaries; each layer can be switched off, department filter) and the **Team grid**: dates across, every person down, a coloured square per leave day |
| Birthdays & Anniversaries | Upcoming birthdays and work anniversaries (30 days / 3 months / 12 months), plus who is still missing a date |
| Analytics | Team count, average age, average length of service, people on leave today; used / left days per person and per leave type; per-person allowance; CSV |
| My leaves | The CEO's own leave requests (approved by another CEO or the developer) |
| Reports | Date-range / department / employee report, CSV export, correct or add records (reason required, audited) |
| Employees | Add (saved without sending any e-mail; the row stays faded with a *Not invited* badge), **Send invitation** whenever you want, then **Send login link** (re-sends the invitation, or a password-reset link if the person already has a password), department, job role, registered devices, delete. **Click a name to open the person's card**: details, leave days and the *Edit details* form are all there (no separate Edit / Details buttons) |
| Settings | Company name, time zone, work hours, **yearly leave allowances**, **public holidays**, **clock-in security**, **company networks**, department heads, job roles |
| Audit Log (*Important changes*) | Only the important entries: people added or removed, account / department / job-role changes, networks, company settings, attendance corrections and cancelled leaves. Routine activity and anything a developer did is **not** shown to CEOs (enforced by the database) |

**CEOs and developers clock in and out like everyone else** (Today tab) and appear in the daily overview, reports, CSV exports, corrections and auto clock-out. In reports they are listed under "CEOs and developers (no department)"; the CSV has an *Account type* column (last column, so existing column positions did not change). **CEOs see everyone's attendance, the developer's included**; they can correct CEO and employee records, but a developer's account and records are read-only for them. Department heads still only see their own department.

**Adding an employee always needs a department**, and a **job role** whenever that department has job roles (today only Production). The database enforces this, not just the form. Moving someone to another department asks for the new job role in the same step.

A department head sees an extra **"<Department> team"** tab: today's status and a date-range report/CSV for their own department only. They cannot edit anything.

### My profile and photos

Everyone (employee, department head, CEO, developer) has a **My profile** button (the name chip in the top bar, and *Edit profile* on the employee page). There they can add, change or remove their own **profile picture** (cropped and shrunk in the browser to a 320 px JPEG) and edit their own **first name, last name and birth date**. Nothing else is editable by the employee: the database function `update_my_profile()` only accepts those three fields and the table still has no client write policies. Photos live in the public Storage bucket `avatars` under `<login id>/<random name>.jpg`; the app stores the path in `employee_profiles.avatar_path` through `set_avatar()`. Only the owner or a developer can write to a folder, so a CEO cannot change anyone else's picture. Deleting an employee also removes their photos. Self-edits are written to the audit log and are shown to the developer, not to CEOs.

### Leaves, calendar and holidays

**Allowances (per person, per calendar year):** 24 vacation days, 15 unpaid leave days, 4 days off. The three numbers are company defaults under *Settings → Company Settings*; a CEO or developer can give one person a different number under *Analytics → Allowance* or in the person's profile card (**Adjust days**, with **−** and **+** buttons for removing and adding days; clear the field to go back to the default).

**Requesting.** Every account (employee, department head, CEO, developer) has a **Book time off** page (type, start date, end date, comment, **approved by**, **replacement**, with a live working-day count and the balance) and a **My leaves** tab with its balances and the upcoming and past leave cards.

* **Approver:** a plain employee picks their department head or a CEO. Any CEO, any developer or the department head can decide the request; nobody can decide their own. A department head's own leave goes to a CEO, a CEO's or developer's leave to another CEO or developer.
* **Replacement:** a colleague of the same department who takes over the tasks. It is required whenever the department has colleagues, and it cannot be someone who is on approved leave in the same dates. CEOs and developers have no replacement.
* **Counting:** days are **working days** (Monday to Friday, public holidays excluded). Pending requests already reserve their days, so nobody can request more than they have. A request over New Year is split between the two years. Allowances are per calendar year and **do not carry over**.
* **Decision:** CEOs, developers and department heads have a **To approve** tab (with a badge) of cards showing the person, dates, working days, the balance left after the request, replacement and comment. **Approve is one click**; Reject asks for an optional note. The full list with filters, cancel and (developer) edit/delete stays under **Leaves**.
* **Decision details:** approve or reject with an optional note. An approved leave appears in the calendar. The owner can cancel a pending leave, or an approved one that has not started; after that only a CEO, developer or the department head can cancel it (with a reason, written to the audit log). Cancelling gives the days back.
* **Developer:** can add, edit (any field, any status, ignoring balances) and delete any leave, edit allowances, birth and start dates, holidays and accounts. CEOs have read-only access to developer data (leaves, allowances, dates).

**Calendar tab** (everyone): public holidays are always shown. An employee also sees their own leaves; a department head the leaves of their department; a CEO or developer everyone's leaves plus **birthdays and work anniversaries**. Month view with an agenda list, usable on a phone.

**Dark / light mode**: the round sun / moon button (top bar, or top right on the sign-in page) switches the look. *Dark* is the original deep-blue style; *Light* follows the Looper poster: soft grey page, white cards, electric-blue gradient, heavy black headings and coral glass cubes. The first visit follows the device setting; once someone presses the button the choice is remembered on that device (`localStorage` key `looper-theme`). It is applied before the first paint, so there is no flash. Front-end only: no database or function change.

**Team grid** (CEO, developer and department heads; employees do not see it): the *Team grid* switch in the Calendar tab shows one row per person (grouped by department) and one column per day of the month. A **green** square is vacation, **red** a day off, **grey** unpaid leave, **blue** a public holiday (for everybody). A leave that is still waiting for approval is striped. Weekends and holidays inside a leave are not leave days, so they are not coloured as leave; the V / UL / DO columns count approved leave days. A CEO or developer can filter by department; a head only gets their own department (the database decides who is returned). Hover a square for the details.

**Birthdays, anniversaries, analytics.** Birth date and start date are entered under *Employees → click the name → Edit details* (or in the add form, or in the profile card) and are visible only to the person, CEOs and developers. Averages only include people whose dates are filled in. 29 February birthdays are celebrated on 28 February in non-leap years; the first anniversary is the first full year.

**Public holidays.** The Georgian holidays for **2025–2040** are in the database (New Year's Day and 2 January, Orthodox Christmas, Epiphany, Mother's Day, Women's Day, National Unity Day, Orthodox Good Friday to Easter Monday, Victory Day, St Andrew's Day, Independence Day, Mariamoba, Svetitskhovloba, Giorgoba; Orthodox Easter is calculated). Holidays that fall on a weekend are **not** moved to another day. *Settings → Public Holidays* lets a CEO or developer add, rename and remove days, and re-add the Georgian ones for any year (2000–2099) with one button. Check the list against the official government calendar each December: the government can add or move days off, and those are entered here by hand. 17 May is not pre-filled because the sources disagree on its current status; add it as a custom holiday if the company observes it.

### Reports, timesheet and profile cards

**Reports** has three views that share one filter bar (date range with ◀ ▶ arrows, *This month*, **Employees**, **Teams**, **Approvers**, **Leave types**, and a **Status** filter in the leave view):

* **Timesheet** (default): a row per person, a column per day with the weekday letters and day numbers, today in bold, public holidays in blue, weekends in grey. Cells show **hours worked** where there is an attendance record (an outline means still clocked in); approved leave is tinted green (**V** vacation), grey (**UL** unpaid leave) or red (**DO** day off); a requested, not yet approved leave is dashed amber; a past working day with no record is an amber **0**; today and later working days show the **scheduled** hours in grey. The right-hand columns total **Hrs**, **V**, **UL** and **DO** (approved working days). *Name ↑* sorts, *Download* gives a CSV. Ranges are limited to 93 days.
* **Records:** the clock-in / clock-out list with corrections and CSV (as before).
* **Leaves:** every leave request touching the dates, with a summary of approved working days per type and a CSV.

Scheduled hours per person are *Working hours per day* from the profile, otherwise the company work day (end time minus start time). A person's approver is the one set in their profile, else the head of their department, else any CEO / developer; the **Approvers** filter follows that rule. Department heads get the same reports for their department, read-only, without the Teams / Approvers filters (they cannot read profiles, so company hours are used).

**Profile card.** In every table and the timesheet, a CEO or developer can click a person's name to open their card: email, position, approver, team, office, permission (User / Department head / CEO / Developer), employment date, service length (years, months, days), country, timezone, date of birth, working days and hours, the **left / used / pending / yearly allowance** per leave type (year selector, **Adjust days**), upcoming planned and approved leaves and leaves already taken. **Edit details** changes office, country, hours, approver and the two dates. CEOs can open and read the developer's card but not change it; the developer can change everyone's.

### Developer account

A developer is the technical owner of the app. They get their own **Developer Dashboard** with:

| Tab | What a developer can do |
|---|---|
| Accounts | Add CEOs, developers and employees; change an account's type (employee / CEO / developer); edit name, number, department, job role, active flag and **login email**; delete accounts, including CEOs |
| Structure | Add, rename, deactivate and **delete** departments and job roles; set department heads |
| Settings | Company settings, clock-in security switches, office networks |
| Leaves / Calendar / Birthdays / Analytics / My leaves | Same as the CEO, plus **add, edit and delete any leave**, change anyone's allowance, birth and start dates |
| Today / Reports | Same as the CEO |
| Audit Log | **Everything**, including developer actions and routine activity, with a filter (*Everything*, *Important only (what CEOs see)*, *Made by developers*, people and structure, attendance, leaves, system) |

Rules: CEOs can see developer accounts but **cannot change them** (they show as *Protected*; the database refuses edits, deletion, account-type changes and removing their devices); a developer cannot change their own type, deactivate or delete themselves, so there is always at least one; developers belong to no department but clock in like everyone else; only a developer can correct a developer's attendance. A department or job role can only be deleted when nobody belongs to it. Everything is written to the audit log; the CEO reads only the important, non-developer entries, the developer reads all of it.

**Create the first developer** once, after applying the migrations: create the login in *Authentication → Users → Add user* (tick *Auto Confirm User*), then edit and run `supabase/tools/create_first_developer.sql` in the SQL editor. Use an email that is not the CEO's. All other accounts are then created from the dashboard.

### Office map (floor plan)

The **Office today** map is the first thing on the **Today** tab of CEOs and developers, and on the **My attendance** tab of employees and department heads (it is not a tab of its own). It is a floor plan with exactly the six rooms of the real office: **Designers** and **Production** on the left, **Account managers** in the middle, **Copywriters** on the right and **CEO 2** above **CEO 1** at the bottom right. Rooms are matched by department name; the first CEO account (lowest employee number) sits in CEO 1, the second in CEO 2. Teams without a room (for example Advertising) and developers are not drawn. Each person who is **clocked in right now** floats as their profile picture in their room. People who work from home (an online day) are **see-through** with a small house badge. Hovering over (or tapping, or focusing with the keyboard) a bubble shows the name and *In the office* / *Online, working from home* (and *Working overtime*). A bubble appears when the person clocks in and disappears when they clock out; the map refreshes every 15 seconds and when the page is opened again. People who are not clocked in are **not named**: they are only drawn as empty seats, so colleagues cannot see who is away, ill or on leave (the database function `office_today()` returns no name, id or photo for them).

### Online work days and overtime

**Online work day.** Before clocking in, an employee (or CEO / developer) chooses **At the company** or **Online**. An online day can be clocked in and out from any network (Face ID / fingerprint still applies when it is on). It is recorded on the attendance record (`work_mode = 'online'`), written to the audit log (developers read it), shown in its own **violet** colour in the Calendar (the person, their department head, CEOs and developers; layer *Online work days*), as an **Online** pill in *Today*, in *Reports → Records* (and the CSV column *Work mode*) and in the timesheet (violet cell, **ON** column). The mode can only be chosen when clocking in; it cannot be changed afterwards. A CEO or developer can switch the feature off for everyone in **Settings → Clock-in Security → Allow online work days**.

**Overtime.** After the company end time (*Settings → work hours*, 19:00 by default) a person who worked **at the company** sees **Log overtime** on the clock-in card. It works only on the company network (when that rule is on) and only if the day is still open or was closed automatically at the end time. It cancels the automatic clock-out; when the person then clocks out (company network, Face ID if on) the clock-out time is the real one and `overtime_minutes` = clock-out minus the end time (for someone who arrived after the end time, minus the arrival). Worked time includes the overtime. A finished overtime is written to the audit log (*Overtime worked*, an **important** entry, so CEOs see it); it also shows in *Today*, *Records* (summary, pill, CSV *Overtime* columns), the timesheet (dot on the cell, **OT** column) and the person's history. If somebody starts overtime and never clocks out, the automatic clock-out closes the day at midnight with the original end time and counts no overtime (*Overtime not ended*); a CEO can correct the record in Reports and the minutes are recalculated. No overtime on an online day.

### Clock-in security

Two switches in **Settings → Clock-in Security** (both **off** after the migration so nobody is locked out):

1. **Require the company network.** Clock in/out is refused unless the request comes from an IP the CEO listed under *Company Networks*. Logging in and viewing history work from anywhere. The CEO can add the network they are on with one click.
2. **Require Face ID / fingerprint.** Every clock-in and clock-out needs a fresh check on a registered device (WebAuthn / passkey). The employee registers a phone or laptop once (re-entering their password), max 3 devices; the CEO can remove devices.

**Company networks have no limit.** Add as many as you need under *Company Networks*: one at a time, with *Add my current network*, or paste a whole list under *Add many at once* (one per line: `Main office, 203.0.113.7`, ranges such as `198.51.100.0/28` and IPv6 prefixes work too; lines that fail are reported with their line number and the rest are still added). Long lists get a search box and paging, and labels can be renamed. The app recognises a network by its **public IP address**, not by the wifi name, so each office, branch or home connection needs its own entry.

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
   3. `20261008120000_developer_role.sql`, the `developer` account type, developer-only functions, and the rule that new employees need a department (and job role when the department has any). Existing employees are not touched.
   4. `20261012120000_leadership_attendance.sql`, CEOs can read every account and attendance record (developer included) but only a developer can change a developer's attendance or remove their devices. No schema change, no Edge Function change.
   5. `20261013120000_leaves_calendar.sql`, leave requests and allowances, public holidays (Georgian 2025–2040 pre-filled), birth and hire dates, the approval rules. Adds three columns to `company_settings` (24 / 15 / 4 defaults); no Edge Function change.
   6. `20261014120000_profile_details.sql`, office, country, working hours per day and a chosen approver on the profile; one `set_employee_profile()` function that replaces `set_employee_dates()` for the app; `list_leaves()` can be limited to one person; the leave form pre-selects the person's approver. Safe to run more than once; no Edge Function change.
   7. `20261016120000_audit_scope.sql`, which audit entries a CEO may read (important, non-developer ones only).
   8. `20261026120000_self_profile_avatars.sql`, profile pictures (`avatars` bucket, `employee_profiles.avatar_path`, `set_avatar()`) and `update_my_profile()` so people can edit their own name and birth date. Redeploy `delete-employee` afterwards.
   9. `20261027120000_online_days_overtime.sql`, online work days (`attendance.work_mode`, `company_settings.allow_online_days`), overtime (`start_overtime()`, `attendance.overtime_minutes`), the new `clock_in(verification, online)` and an auto clock-out that leaves overtime days open.
   10. `20261028120000_office_today.sql`, the `office_today()` function behind the office map (names only for people who are clocked in).
3. If the migration prints `pg_cron is not available`, enable the *pg_cron* extension in the dashboard and run:
   `select cron.schedule('auto-clock-out', '*/10 * * * *', 'select public.auto_clock_out()');`
4. Check Dashboard → Authentication → URL Configuration: the Site URL and redirect list must include `https://YOUR-SITE/set-password`. If it is missing, Supabase sends the person to the site root instead; the app now still shows the *Create Your Password* page (or *Link problem* for an expired link) in that case, but add the address anyway.
   **Optional but recommended, so e-mail scanners cannot use up the link:** some mail providers open links to scan them, which makes the one-time invitation link "expired" before the person clicks it. In *Authentication → Email Templates* change the button link of **Invite user** to `{{ .SiteURL }}/set-password?token_hash={{ .TokenHash }}&type=invite` and of **Reset password** to `{{ .SiteURL }}/set-password?token_hash={{ .TokenHash }}&type=recovery`. The page then shows a *Continue* button and only uses the link when the person presses it. The default links keep working too.
   The bottom of every page shows the running version (commit and date); use it to check that the site has really been updated.

### Edge Functions

```bash
supabase secrets set SITE_URL=https://your-site.example     # used for invitation links AND as the CORS origin
# optional: ALLOWED_ORIGINS=https://your-site.example,http://localhost:5173
supabase functions deploy invite-employee
supabase functions deploy delete-employee
supabase functions deploy webauthn
supabase functions deploy change-email
```

`SITE_URL` is required: the invite function refuses to run without it instead of falling back to localhost.

**Face ID / fingerprint needs HTTPS** (or `localhost`). The relying-party ID defaults to the hostname of `SITE_URL`; set `WEBAUTHN_RP_ID` only if you serve the app from a subdomain and want one registration to cover the parent domain. Changing the domain later invalidates registered devices.

### Rollout checklist

0. Apply migrations 3 to 13, deploy `invite-employee`, `delete-employee` and `change-email` again, and create the first developer (see *Developer account*). If you already did this for migration 3, only `supabase db push` is needed for migration 4.
1. Apply migration 2 and deploy the `webauthn` function. Nothing changes for employees yet.
2. As CEO open the **Employees** tab and set each person's department and (for Production) job role, then pick the five department heads under **Settings**.
3. **Settings → Company Networks:** while on the office wifi press *Add my current network*. Check that the shown IP is the office's public IP.
4. Turn on **Require the company network** and test a clock-in from the office and from a phone on mobile data (it must be refused).
5. **Leaves:** run `supabase db push` for migration 5, push the front end, then as CEO enter each person's **birth date and start date** (Employees → click the name → *Edit details*; the *Birthdays & Anniversaries* tab lists who is missing), check **Settings → Public Holidays** for the current year and adjust the three allowance defaults if needed.
6. **Profile cards and timesheet:** run `supabase db push` for migration 6 and push the front end. Optionally fill in office, country, working hours and approver per person (click a name, *Edit details*).
7. **Audit scope and new look:** run `supabase db push` for migration 7 (`20261016120000_audit_scope.sql`) and push the front end. No Edge Function needs redeploying.
8. **Profile pictures and self-edit (migration 8):** run `supabase db push` for migration 8 (`20261026120000_self_profile_avatars.sql`, creates the `avatars` bucket and its policies), **redeploy `delete-employee`** (`supabase functions deploy delete-employee`, so photos are removed with the person) and push the front end.
9. **Online days and overtime:** run `supabase db push` for migration 9 (`20261027120000_online_days_overtime.sql`) and push the front end. No Edge Function needs redeploying. Check that the *pg_cron* job `auto-clock-out` is running (it already should be): overtime relies on it.
10. **Office map:** run `supabase db push` for migration 10 (`20261028120000_office_today.sql`) and push the front end. Nothing else to configure; people see it on Today / My attendance.
11. **Send login link fix:** redeploy `invite-employee` (`supabase functions deploy invite-employee`) and push the front end. No migration. The button now sends an invitation to people who never signed in, and a password-reset link to people who already did (for example after forgetting the password). Supabase only allows one auth e-mail per address about every minute; the CEO sees a clear "wait a minute" message if it is hit. Employees can also reset on their own with *Forgot your password?* on the login page.
12. **Add first, invite later (migration 11):** run `supabase db push` for migration 11 (`20261029120000_audit_employee_create.sql`), redeploy `invite-employee` and `change-email`, and push the front end. *Add Employee* now only saves the person (no login, no e-mail); the faded row's **Send invitation** button creates the login and sends the e-mail whenever you choose. After they set a password they are a normal employee.
13. **Leave days used before the app (migration 12):** run `supabase db push` for migration 12 (`20261030120000_leave_imported_usage.sql`). It adds `leave_imported_usage`: yearly totals of leave days people already took (no dates), which count as approved days in every balance but create no calendar entries. It is filled by a one-off SQL import, not from the app. No Edge Function or front-end change.
14. **Delete several leaves (migration 13):** run `supabase db push` for migration 13 (`20261031120000_dev_delete_leaves.sql`) and push the front end. Developers get tick boxes in the Leaves tab and a *Delete selected* button (up to 500 at a time, one audit entry per leave). No Edge Function changes.
15. Ask employees to open the app on their phone and register it (**My Devices → Register this device**), then turn on **Require Face ID / fingerprint**.

## Tests

```bash
npm run lint
npm test                              # time zone, CSV, calendar, leave, birthday, timesheet, team grid and theme helpers
npm run build

# Database (needs a throw-away Postgres 14+; never run against production)
PGHOST=localhost PGUSER=postgres bash supabase/tests/run.sh
```

The database tests build a mock of Supabase's `auth` schema, apply all thirteen migrations and assert RLS, department-head scope, job-role integrity, network enforcement (including spoofed headers), one-time biometric tokens, server-side time, corrections, audit entries, auto clock-out (including overnight shifts), the delete order, CEO / developer attendance rules, 300 company networks (single addresses, a range and an IPv6 prefix), and the leave rules: Georgian holidays and Orthodox Easter for 2025–2030 and 2035, working-day counting, year splits, approval authority, overlaps, balances, replacement conflicts, cancel rules, listing scopes, allowances, profile privacy, developer edit rights, audit rows and cascade deletes, and the profile details (office, country, hours, approver, one-person leave lists, approver pre-selection), self-service profiles (own name / birth date only, photo rules, storage policies, privacy), online work days and overtime (network rules, Face ID, minutes, auto clock-out, visibility, audit), and the office map (who appears, privacy of absent people, clock-out removes the bubble).

CI (`.github/workflows/ci.yml`) runs lint, unit tests, build, the database tests on Postgres 16 and `deno check` on all four Edge Functions.

## Project layout

```
src/
  services/    supabase client + api.js (all queries / RPC / function calls)
  hooks/       useAuth (session, profile, settings), useLoad, useMyAttendance
  components/  ui primitives, Toast, Modal/ConfirmDialog, AttendancePanel, DevicesCard, TeamOverview, MonthCalendar, LeaveCard, LeaveRequestModal, DevLeaveModal, EmployeeDatesModal
  views/       Login, SetPassword, EmployeeDashboard, HeadTeam, MyLeaves, CalendarView, CeoDashboard, DeveloperDashboard, ceo/* tabs (Leaves, Celebrations, Analytics, Holidays, ...)
  lib/         time (company time-zone helpers), csv, biometric (WebAuthn in the browser), networks, calendar (date maths), leaves (rules mirrored for previews), celebrations (birthdays, anniversaries, averages)
supabase/
  migrations/  schema hardening + features
  functions/   invite-employee, delete-employee, change-email, webauthn, _shared
  tests/       SQL tests
  tools/       create_first_developer.sql
```

## Known limits / ideas

* **The biometric check cannot prove "face" or "fingerprint" specifically.** WebAuthn only tells the server that the device's owner verified themselves (`userVerification: required`); on some phones that can be the device PIN. It does prove a registered device was physically unlocked at that moment.
* **IPv6:** a network is stored as the /64 prefix, IPv4 as a single address. If the office has a changing public IP, re-add it (or ask the ISP for a fixed one).
* **Leaves are in working days only**: half days and hours are not supported, and unused days do not carry over to the next year (change the allowance of a person for a year under Analytics if you want to grant extra days).
* **Georgian holidays come from a fixed list**, not from the government: if a day off is moved or added by decree, edit *Settings → Public Holidays*.
* **Verify `cf-connecting-ip`** on your project once (the *Add my current network* button shows the IP the server sees) before turning the network rule on. If the header is ever absent, clock-in is refused, not allowed.
* A VPN or phone hotspot that exits through the office network would pass the network rule; the rule limits location, it is not a proof of presence.
* Department heads are read-only. Letting them correct records would be a small addition to the RPCs plus a UI change.
* The developer account is as powerful as the database allows: protect its password, and consider turning on two-factor authentication for it in Supabase Auth.
* `is_ceo()` in the database means "CEO or developer" (admin rights); use `is_developer()` for developer-only things.
* One record per employee per work date (split shifts are not supported).
* No rate limiting on the Edge Functions beyond Supabase's defaults.
