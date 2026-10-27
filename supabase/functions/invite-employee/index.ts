// Creates an employee and sends the invitation e-mail, or sends / re-sends it later.
//
// Body (create, optionally + invite):
//   { employeeNumber, firstName, lastName, email, departmentId, jobRoleId?, role?, sendNow? }
//   - sendNow: false only saves the person; no e-mail is sent and no login exists yet.
//     The CEO sends the invitation whenever they like with { employeeId } (below).
//     Omitted or true keeps the old behaviour: create and invite in one step.
//   - role defaults to "employee". An employee MUST have a department, and a job role
//     whenever that department has job roles (the database enforces this too).
//   - role "ceo" or "developer" can only be created by a developer and needs no department.
// Body (send a login link for an existing employee):
//   { employeeId }
//   - no login yet     -> the first invitation is sent (the login account is created now)
//   - never signed in  -> the invitation is sent again
//   - already signed in (forgot the password) -> a password-reset link is sent
//
// Create + invite is all-or-nothing: if the invitation cannot be sent the
// employee row that was just created is removed again.
import {
  audit,
  HttpError,
  optionalUuid,
  readJson,
  requireCeo,
  requireEmail,
  requireText,
  requireUuid,
  serve,
  type CeoContext,
} from "../_shared/common.ts";
import { friendlyMailError, isAlreadyRegistered, isRateLimit, planResend } from "../_shared/resend.js";

type EmployeeRow = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  auth_user_id: string | null;
  is_active: boolean;
  role?: string;
};

const COLUMNS =
  "id, employee_number, first_name, last_name, email, auth_user_id, is_active, role";

const ROLES = ["employee", "ceo", "developer"];

function redirectUrl(): string {
  const siteUrl = Deno.env.get("SITE_URL")?.trim().replace(/\/+$/, "");
  if (!siteUrl) {
    console.error("SITE_URL secret is not set.");
    throw new HttpError(
      500,
      "SITE_URL is not configured on the server, so invitation links cannot be created.",
    );
  }
  return `${siteUrl}/set-password`;
}

async function sendInvite(ctx: CeoContext, emp: EmployeeRow, email: string) {
  const { data, error } = await ctx.admin.auth.admin.inviteUserByEmail(email, {
    data: {
      employee_id: emp.id,
      employee_number: emp.employee_number,
      first_name: emp.first_name,
      last_name: emp.last_name,
    },
    redirectTo: redirectUrl(),
  });
  if (error) {
    console.error("Invite error:", error.message);
    throw new HttpError(isRateLimit(error.message) ? 429 : 400, friendlyMailError(error.message));
  }
  if (!data?.user?.id) {
    throw new HttpError(500, "Invitation was sent but no user id was returned.");
  }
  return data.user.id;
}

// Password-reset e-mail for an account that already exists (the "I forgot my password" case).
async function sendReset(ctx: CeoContext, email: string) {
  const { error } = await ctx.admin.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
  if (error) {
    console.error("Reset error:", error.message);
    throw new HttpError(isRateLimit(error.message) ? 429 : 400, friendlyMailError(error.message));
  }
}

async function createAndInvite(ctx: CeoContext, body: Record<string, unknown>) {
  const employeeNumber = requireText(body.employeeNumber, "Employee number", 32);
  const firstName = requireText(body.firstName, "First name");
  const lastName = requireText(body.lastName, "Last name");
  const email = requireEmail(body.email);
  const role = body.role === undefined || body.role === null || body.role === ""
    ? "employee"
    : String(body.role);
  if (!ROLES.includes(role)) throw new HttpError(400, "Unknown account type.");
  if (role !== "employee" && !ctx.isDeveloper) {
    throw new HttpError(403, "Only a developer can create CEO or developer accounts.");
  }

  // Employees need a department (and a job role if it has any). CEO / developer accounts
  // belong to no department.
  const departmentId = role === "employee" ? optionalUuid(body.departmentId, "departmentId") : null;
  const jobRoleId = role === "employee" ? optionalUuid(body.jobRoleId, "jobRoleId") : null;
  if (role === "employee" && !departmentId) {
    throw new HttpError(400, "Choose a department for the new employee.");
  }
  if (jobRoleId && !departmentId) {
    throw new HttpError(400, "Choose a department before choosing a job role.");
  }

  // 1. Create the row (the new row can be rolled back if the invite fails).
  const { data: created, error: insertError } = await ctx.admin
    .from("employees")
    .insert({
      employee_number: employeeNumber,
      first_name: firstName,
      last_name: lastName,
      email,
      department_id: departmentId,
      job_role_id: jobRoleId,
      role,
      is_active: true,
    })
    .select(COLUMNS)
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const text = `${insertError.message} ${insertError.details ?? ""}`;
      throw new HttpError(
        409,
        text.includes("employee_number")
          ? "An employee with this number already exists."
          : "An employee with this email already exists.",
      );
    }
    if (insertError.code === "23503") {
      throw new HttpError(400, "That job role does not belong to the selected department.");
    }
    if (insertError.code === "22023" || insertError.code === "P0002") {
      // Raised by the database's department / job role rules, with a readable message.
      throw new HttpError(400, insertError.message);
    }
    console.error("Employee insert error:", insertError);
    throw new HttpError(500, "Could not create the employee record.");
  }

  const emp = created as EmployeeRow;

  // 1b. Only saving the person: no e-mail, no login account. They are invited later.
  if (body.sendNow === false) {
    await audit(ctx, "employee.create", emp.id, `Added ${firstName} ${lastName} (not invited yet)`, {
      employee_number: employeeNumber,
      role,
      email,
      department_id: departmentId,
      job_role_id: jobRoleId,
    });
    return {
      message: `${firstName} ${lastName} was added. No e-mail has been sent yet.`,
      employeeId: emp.id,
      created: true,
      kind: "none",
    };
  }

  // 2. Invite; on failure remove the row again.
  let authUserId: string;
  try {
    authUserId = await sendInvite(ctx, emp, email);
  } catch (err) {
    await ctx.admin.from("employees").delete().eq("id", emp.id);
    throw err;
  }

  // 3. Link; on failure remove both so nothing is left half-created.
  const { error: linkError } = await ctx.admin
    .from("employees")
    .update({ auth_user_id: authUserId })
    .eq("id", emp.id);

  if (linkError) {
    console.error("Employee link error:", linkError);
    await ctx.admin.auth.admin.deleteUser(authUserId);
    await ctx.admin.from("employees").delete().eq("id", emp.id);
    throw new HttpError(
      500,
      "The invitation could not be completed. Nothing was created; please try again.",
    );
  }

  await audit(ctx, "employee.invite", emp.id, `Invited ${firstName} ${lastName}`, {
    employee_number: employeeNumber,
    role,
    email,
    department_id: departmentId,
    job_role_id: jobRoleId,
  });

  return {
    message: `Invitation sent to ${email}`,
    employeeId: emp.id,
    created: true,
  };
}

async function resendInvite(ctx: CeoContext, employeeId: string) {
  const { data, error } = await ctx.admin
    .from("employees")
    .select(COLUMNS)
    .eq("id", employeeId)
    .maybeSingle();

  if (error) {
    console.error("Employee lookup error:", error);
    throw new HttpError(500, "Could not look up the employee.");
  }
  if (!data) throw new HttpError(404, "Employee not found.");

  const emp = data as EmployeeRow;
  // CEOs cannot see or touch developer accounts.
  if (emp.role === "developer" && !ctx.isDeveloper) throw new HttpError(404, "Employee not found.");
  if (!emp.is_active) throw new HttpError(400, "This employee is inactive.");
  if (!emp.email) {
    throw new HttpError(400, "This employee does not have an email address.");
  }

  let kind: "invite" | "reset" = "invite";
  const firstInvite = !emp.auth_user_id;
  if (emp.auth_user_id) {
    const { data: authData, error: authError } = await ctx.admin.auth.admin
      .getUserById(emp.auth_user_id);
    if (authError || !authData?.user) {
      throw new HttpError(500, "Could not check the employee's login account.");
    }
    if (planResend(authData.user) === "reset") {
      // Already used the account: they forgot the password, so send a reset link.
      kind = "reset";
      await sendReset(ctx, emp.email);
    } else {
      // Account exists but was never used: re-sending the invite is safe.
      try {
        await sendInvite(ctx, emp, emp.email);
      } catch (err) {
        // The auth server may refuse to invite an address that is already registered: a reset link works then.
        if (!(err instanceof HttpError) || !isAlreadyRegistered(err.message)) throw err;
        kind = "reset";
        await sendReset(ctx, emp.email);
      }
    }
  } else {
    const authUserId = await sendInvite(ctx, emp, emp.email);
    const { error: linkError } = await ctx.admin
      .from("employees")
      .update({ auth_user_id: authUserId })
      .eq("id", emp.id);
    if (linkError) {
      console.error("Employee link error:", linkError);
      await ctx.admin.auth.admin.deleteUser(authUserId);
      throw new HttpError(500, "The invitation could not be completed. Please try again.");
    }
  }

  if (kind === "reset") {
    await audit(ctx, "employee.password_reset", emp.id,
      `Sent a password-reset link to ${emp.first_name} ${emp.last_name}`, { email: emp.email });
    return { message: `Password reset link sent to ${emp.email}`, employeeId: emp.id, created: false, kind };
  }

  if (firstInvite) {
    await audit(ctx, "employee.invite", emp.id, `Invited ${emp.first_name} ${emp.last_name}`, { email: emp.email });
  } else {
    await audit(ctx, "employee.invite_resend", emp.id,
      `Re-sent invitation to ${emp.first_name} ${emp.last_name}`, { email: emp.email });
  }

  return { message: `Invitation sent to ${emp.email}`, employeeId: emp.id, created: false, kind };
}

serve(async (req) => {
  const ctx = await requireCeo(req);
  const body = await readJson(req);

  if (body.employeeId !== undefined) {
    return await resendInvite(ctx, requireUuid(body.employeeId, "employeeId"));
  }
  return await createAndInvite(ctx, body);
});
