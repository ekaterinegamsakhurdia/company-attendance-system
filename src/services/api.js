// All Supabase calls live here so views stay free of query strings.
// Every function throws an Error with a user-readable message on failure.
import { supabase } from './supabase';
import { friendlyNetworkError } from '../lib/networks';

const EMPLOYEE_COLUMNS =
  'id, auth_user_id, employee_number, first_name, last_name, email, role, is_active, department_id, job_role_id';
const ATTENDANCE_COLUMNS =
  'id, employee_id, employee_number, employee_name, work_date, clock_in, clock_out, clockout_type, worked_minutes, clock_in_biometric, clock_out_biometric, work_mode, overtime_started_at, overtime_minutes';

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Request failed.');
  return data;
}

/** Edge Function errors hide the real message in the Response body. */
async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message || 'Request failed.';
    let code;
    try {
      const payload = await error.context?.json?.();
      if (payload?.error) message = payload.error;
      code = payload?.code;
    } catch {
      /* body was not JSON */
    }
    throw Object.assign(new Error(message), { code });
  }
  if (!data?.success) throw new Error(data?.error || 'Request failed.');
  return data;
}

/* ---------- session / profile ---------- */

export async function fetchMyEmployee(authUserId) {
  const data = unwrap(
    await supabase.from('employees').select(EMPLOYEE_COLUMNS).eq('auth_user_id', authUserId).maybeSingle(),
  );
  if (!data) throw new Error('Your account is not linked to an employee record.');
  if (!data.is_active) throw new Error('Your employee account is inactive.');
  return data;
}

/** Department the signed-in employee heads, or null. */
export async function fetchHeadedDepartment(employeeId) {
  return unwrap(
    await supabase.from('departments').select('id, name').eq('head_employee_id', employeeId).maybeSingle(),
  );
}

export async function fetchAppSettings() {
  const rows = unwrap(await supabase.rpc('get_app_settings'));
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}

/* ---------- my attendance ---------- */

export async function fetchAttendanceForDay(employeeId, workDate) {
  return unwrap(
    await supabase
      .from('attendance')
      .select(ATTENDANCE_COLUMNS)
      .eq('employee_id', employeeId)
      .eq('work_date', workDate)
      .maybeSingle(),
  );
}

export async function fetchMyHistory(employeeId, limit = 30) {
  return (
    unwrap(
      await supabase
        .from('attendance')
        .select(ATTENDANCE_COLUMNS)
        .eq('employee_id', employeeId)
        .order('work_date', { ascending: false })
        .limit(limit),
    ) ?? []
  );
}

// Time is taken by the database, never by the browser. When biometric checks are
// required, `verificationId` is the one-time token returned by the webauthn function.
/** `online` = a work-from-home day: allowed from any network (Face ID / fingerprint still applies). */
export async function clockIn(verificationId = null, online = false) {
  return unwrap(await supabase.rpc('clock_in', { p_verification: verificationId, p_online: online }));
}

/** After the company end time, on the company network: keep the day open and count the extra time. */
export async function startOvertime() {
  return unwrap(await supabase.rpc('start_overtime'));
}

export async function clockOut(verificationId = null) {
  return unwrap(await supabase.rpc('clock_out', { p_verification: verificationId }));
}

/** Who is clocked in right now, per room (names only for people who are in). */
export async function fetchOfficeToday() {
  return unwrap(await supabase.rpc('office_today')) ?? [];
}

/** { ip, required, on_company_network } as seen by the server. */
export async function fetchNetworkStatus() {
  return unwrap(await supabase.rpc('my_network_status'));
}

/* ---------- biometric devices ---------- */

export const webauthnStep = (step, body = {}) => invoke('webauthn', { step, ...body });

const DEVICE_COLUMNS = 'id, employee_id, device_name, created_at, last_used_at';

export async function listDevices(employeeId) {
  let query = supabase.from('webauthn_credentials').select(DEVICE_COLUMNS).order('created_at');
  if (employeeId) query = query.eq('employee_id', employeeId);
  return unwrap(await query) ?? [];
}

export async function removeDevice(credentialRowId) {
  unwrap(await supabase.rpc('remove_webauthn_credential', { p_credential_id: credentialRowId }));
}

/* ---------- CEO / developer: directory ---------- */

export async function listEmployees() {
  return (
    unwrap(await supabase.from('employees').select(EMPLOYEE_COLUMNS).order('employee_number', { ascending: true })) ?? []
  );
}

export async function listDepartments() {
  return (
    unwrap(await supabase.from('departments').select('id, name, is_active, head_employee_id').order('name')) ?? []
  );
}

export async function listJobRoles() {
  return unwrap(await supabase.from('job_roles').select('id, department_id, name, is_active').order('name')) ?? [];
}

export async function createJobRole(departmentId, name) {
  return unwrap(
    await supabase.from('job_roles').insert({ department_id: departmentId, name: name.trim() }).select().single(),
  );
}

export async function updateJobRole(id, patch) {
  return unwrap(await supabase.from('job_roles').update(patch).eq('id', id).select().single());
}

export async function setDepartmentHead(departmentId, employeeId) {
  unwrap(
    await supabase.rpc('ceo_set_department_head', {
      p_department_id: departmentId,
      p_employee_id: employeeId || null,
    }),
  );
}

export async function setEmployeeJobRole(employeeId, jobRoleId) {
  unwrap(
    await supabase.rpc('ceo_set_employee_job_role', {
      p_employee_id: employeeId,
      p_job_role_id: jobRoleId || null,
    }),
  );
}

/* ---------- CEO: allowed networks ---------- */

export async function listNetworks() {
  return unwrap(await supabase.from('allowed_networks').select('id, label, network, is_active, created_at').order('created_at')) ?? [];
}

export async function addMyNetwork(label) {
  return unwrap(await supabase.rpc('ceo_add_my_network', { p_label: label }));
}

export async function addNetwork(label, network) {
  const { data, error } = await supabase
    .from('allowed_networks')
    .insert({ label: label.trim(), network: network.trim() })
    .select()
    .single();
  if (error) throw new Error(friendlyNetworkError(error.message));
  return data;
}

/**
 * Adds many networks at once. One request when everything is valid; if anything is
 * rejected, falls back to one-by-one so the good lines still go in.
 * Returns { added, failed: [{ line, network, message }] }.
 */
export async function addNetworks(items) {
  if (items.length === 0) return { added: 0, failed: [] };
  const rows = items.map((i) => ({ label: i.label.trim(), network: i.network.trim() }));
  const bulk = await supabase.from('allowed_networks').insert(rows);
  if (!bulk.error) return { added: rows.length, failed: [] };

  let added = 0;
  const failed = [];
  for (const item of items) {
    try {
      await addNetwork(item.label, item.network);
      added += 1;
    } catch (err) {
      failed.push({ line: item.line, network: item.network, message: err.message });
    }
  }
  return { added, failed };
}

export async function updateNetwork(id, patch) {
  return unwrap(await supabase.from('allowed_networks').update(patch).eq('id', id).select().single());
}

export async function deleteNetwork(id) {
  unwrap(await supabase.from('allowed_networks').delete().eq('id', id));
}

export async function createDepartment(name) {
  return unwrap(await supabase.from('departments').insert({ name: name.trim() }).select().single());
}

export async function updateDepartment(id, patch) {
  return unwrap(await supabase.from('departments').update(patch).eq('id', id).select().single());
}

/** Department and job role are always set together (the role is required when the department has roles). */
export async function setEmployeeDepartment(employeeId, departmentId, jobRoleId = null) {
  unwrap(
    await supabase.rpc('ceo_set_employee_department', {
      p_employee_id: employeeId,
      p_department_id: departmentId || null,
      p_job_role_id: jobRoleId || null,
    }),
  );
}

/* ---------- developer ---------- */

export async function setEmployeeAccountType(employeeId, role) {
  unwrap(await supabase.rpc('dev_set_employee_role', { p_employee_id: employeeId, p_role: role }));
}

export async function updateEmployee(employeeId, f) {
  unwrap(
    await supabase.rpc('dev_update_employee', {
      p_employee_id: employeeId,
      p_employee_number: f.employeeNumber,
      p_first_name: f.firstName,
      p_last_name: f.lastName,
      p_department_id: f.departmentId || null,
      p_job_role_id: f.jobRoleId || null,
      p_is_active: f.isActive,
    }),
  );
}

export async function deleteDepartment(departmentId) {
  unwrap(await supabase.rpc('dev_delete_department', { p_department_id: departmentId }));
}

export async function deleteJobRole(jobRoleId) {
  unwrap(await supabase.rpc('dev_delete_job_role', { p_job_role_id: jobRoleId }));
}

export const changeEmail = (employeeId, email) => invoke('change-email', { employeeId, email });

export const inviteEmployee = (payload) => invoke('invite-employee', payload);
export const resendInvite = (employeeId) => invoke('invite-employee', { employeeId });
export const deleteEmployee = (employeeId) => invoke('delete-employee', { employeeId });

/* ---------- CEO: attendance ---------- */

export async function fetchAttendanceOnDate(workDate) {
  return unwrap(await supabase.from('attendance').select(ATTENDANCE_COLUMNS).eq('work_date', workDate)) ?? [];
}

/** All rows in [from, to] (inclusive), paged past the API's 1000-row cap. */
export async function fetchAttendanceRange({ from, to, employeeId, employeeIds }) {
  const PAGE = 1000;
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    let query = supabase
      .from('attendance')
      .select(ATTENDANCE_COLUMNS)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date', { ascending: false })
      .order('clock_in', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (employeeIds) query = query.in('employee_id', employeeIds);
    const page = unwrap(await query) ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** Online work days in [from, to]; the database returns only the rows the person may see. */
export async function fetchOnlineDays({ from, to }) {
  return (
    unwrap(
      await supabase
        .from('attendance')
        .select('id, employee_id, employee_name, work_date')
        .eq('work_mode', 'online')
        .gte('work_date', from)
        .lte('work_date', to)
        .order('work_date'),
    ) ?? []
  );
}

export async function saveAttendance({ id = null, employeeId, clockIn, clockOut, reason }) {
  return unwrap(
    await supabase.rpc('ceo_save_attendance', {
      p_attendance_id: id,
      p_employee_id: employeeId,
      p_clock_in: clockIn,
      p_clock_out: clockOut,
      p_reason: reason,
    }),
  );
}

export async function deleteAttendance(id, reason) {
  unwrap(await supabase.rpc('ceo_delete_attendance', { p_attendance_id: id, p_reason: reason }));
}

/* ---------- CEO: settings & audit ---------- */

export async function fetchCompanySettings() {
  return unwrap(await supabase.from('company_settings').select('*').eq('id', 1).single());
}

export async function saveCompanySettings(patch) {
  return unwrap(await supabase.from('company_settings').update(patch).eq('id', 1).select().single());
}

export async function fetchAuditLogs({ limit = 50, offset = 0 } = {}) {
  return (
    unwrap(
      await supabase
        .from('audit_logs')
        .select('id, actor_user_id, employee_id, action, description, ip_address, metadata, created_at')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ) ?? []
  );
}

/* ---------- leaves, holidays, birthdays ---------- */

export async function listHolidays({ from, to } = {}) {
  let query = supabase.from('public_holidays').select('id, holiday_date, name, is_official').order('holiday_date');
  if (from) query = query.gte('holiday_date', from);
  if (to) query = query.lte('holiday_date', to);
  return unwrap(await query) ?? [];
}

export async function addHoliday({ date, name }) {
  const { data, error } = await supabase
    .from('public_holidays')
    .insert({ holiday_date: date, name: name.trim(), is_official: false })
    .select()
    .single();
  if (error) {
    throw new Error(/duplicate|unique/i.test(error.message) ? 'That holiday is already in the list.' : error.message);
  }
  return data;
}

export async function updateHoliday(id, { date, name }) {
  const { data, error } = await supabase
    .from('public_holidays')
    .update({ holiday_date: date, name: name.trim() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    throw new Error(/duplicate|unique/i.test(error.message) ? 'That holiday is already in the list.' : error.message);
  }
  return data;
}

export async function deleteHoliday(id) {
  unwrap(await supabase.from('public_holidays').delete().eq('id', id));
}

/** Adds the Georgian public holidays for a year; returns how many were new. */
export async function addGeorgianHolidays(year) {
  return unwrap(await supabase.rpc('add_georgian_holidays', { p_year: year }));
}

/** { approvers: [{id,name,kind}], replacements: [{id,name}], replacement_required } */
export async function fetchLeaveOptions() {
  return unwrap(await supabase.rpc('leave_form_options'));
}

export async function requestLeave({ category, start, end, comment, approverId, replacementId }) {
  return unwrap(
    await supabase.rpc('request_leave', {
      p_category: category,
      p_start: start,
      p_end: end,
      p_comment: comment?.trim() || null,
      p_approver_id: approverId,
      p_replacement_id: replacementId || null,
    }),
  );
}

export async function decideLeave(leaveId, decision, comment) {
  return unwrap(
    await supabase.rpc('decide_leave', { p_leave_id: leaveId, p_decision: decision, p_comment: comment?.trim() || null }),
  );
}

export async function cancelLeave(leaveId, reason) {
  return unwrap(await supabase.rpc('cancel_leave', { p_leave_id: leaveId, p_reason: reason?.trim() || null }));
}

/** scope 'mine' = my own leaves; 'managed' = everyone's (CEO / developer) or my department's (head). */
export async function listLeaves(scope, { from = null, to = null, status = null, employeeId = null } = {}) {
  return (
    unwrap(
      await supabase.rpc('list_leaves', { p_scope: scope, p_from: from, p_to: to, p_status: status, p_employee_id: employeeId }),
    ) ?? []
  );
}

export async function fetchLeaveBalance(employeeId, year) {
  return unwrap(await supabase.rpc('leave_balance', { p_employee_id: employeeId, p_year: year })) ?? [];
}

export async function fetchAllBalances(year) {
  return unwrap(await supabase.rpc('leave_balances_all', { p_year: year })) ?? [];
}

/** Profile details (dates, office, country, hours, approver): your own, or everyone's for a CEO / developer. */
export async function listProfiles() {
  return (
    unwrap(await supabase.from('employee_profiles').select('employee_id, birth_date, hire_date, office, country, daily_hours, approver_id, avatar_path')) ?? []
  );
}

/** Saves all profile fields of one person (CEO / developer). Empty values clear the field. */
export async function setEmployeeProfile(employeeId, f) {
  const hours = f.dailyHours === '' || f.dailyHours === null || f.dailyHours === undefined ? null : Number(f.dailyHours);
  unwrap(
    await supabase.rpc('set_employee_profile', {
      p_employee_id: employeeId,
      p_birth_date: f.birthDate || null,
      p_hire_date: f.hireDate || null,
      p_office: f.office?.trim() || null,
      p_country: f.country?.trim() || null,
      p_daily_hours: hours,
      p_approver_id: f.approverId || null,
    }),
  );
}

/** days = null removes the override, so the company default applies again. */
export async function setLeaveAllowance(employeeId, year, category, days) {
  unwrap(
    await supabase.rpc('set_leave_allowance', {
      p_employee_id: employeeId,
      p_year: year,
      p_category: category,
      p_days: days === '' || days === undefined ? null : days,
    }),
  );
}

/** Developer only: create (id = null) or change any leave, whatever its status. */
export async function devSaveLeave(f) {
  return unwrap(
    await supabase.rpc('dev_save_leave', {
      p_leave_id: f.id ?? null,
      p_employee_id: f.employeeId,
      p_category: f.category,
      p_start: f.start,
      p_end: f.end,
      p_comment: f.comment ?? null,
      p_approver_id: f.approverId || null,
      p_replacement_id: f.replacementId || null,
      p_status: f.status,
      p_decision_comment: f.decisionComment ?? null,
    }),
  );
}

export async function devDeleteLeave(leaveId) {
  unwrap(await supabase.rpc('dev_delete_leave', { p_leave_id: leaveId }));
}

/* ---------- auth ---------- */

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

/** The signed-in person's own profile row (photo, birth date), or null. */
export async function fetchMyProfile(employeeId) {
  const rows = unwrap(await supabase.from('employee_profiles').select('employee_id, birth_date, avatar_path')) ?? [];
  return rows.find((r) => r.employee_id === employeeId) ?? null;
}

/** Everyone may change only their own first name, last name and birth date. */
export async function updateMyProfile({ firstName, lastName, birthDate }) {
  unwrap(
    await supabase.rpc('update_my_profile', {
      p_first_name: firstName,
      p_last_name: lastName,
      p_birth_date: birthDate || null,
    }),
  );
}

const AVATAR_BUCKET = 'avatars';

/** Public address of a stored profile photo (path as saved in employee_profiles.avatar_path). */
export function avatarUrl(path) {
  if (!path) return null;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Uploads a new photo (already a small JPEG blob) for `employee` and makes it their photo.
 * The previous file is deleted afterwards; a failure there is harmless.
 */
export async function uploadAvatar(employee, blob, previousPath) {
  if (!employee.auth_user_id) throw new Error('This person has no login yet, so a photo cannot be stored.');
  const path = `${employee.auth_user_id}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
  });
  if (error) throw new Error(error.message || 'The photo could not be uploaded.');
  const saved = await supabase.rpc('set_avatar', { p_employee_id: employee.id, p_path: path });
  if (saved.error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {});
    throw new Error(saved.error.message || 'The photo could not be saved.');
  }
  if (previousPath) await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]).catch(() => {});
  return path;
}

export async function removeAvatar(employee, previousPath) {
  unwrap(await supabase.rpc('set_avatar', { p_employee_id: employee.id, p_path: null }));
  if (previousPath) await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]).catch(() => {});
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/set-password`,
  });
  if (error) throw new Error(error.message);
}
