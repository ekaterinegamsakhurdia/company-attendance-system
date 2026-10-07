// Creates an employee and sends the invitation e-mail, or re-sends it.
//
// Body (create + invite):
//   { employeeNumber, firstName, lastName, email, departmentId? }
// Body (resend for an existing employee):
//   { employeeId }
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

type EmployeeRow = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  auth_user_id: string | null;
  is_active: boolean;
};

const COLUMNS =
  "id, employee_number, first_name, last_name, email, auth_user_id, is_active";

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
    throw new HttpError(400, error.message);
  }
  if (!data?.user?.id) {
    throw new HttpError(500, "Invitation was sent but no user id was returned.");
  }
  return data.user.id;
}

async function createAndInvite(ctx: CeoContext, body: Record<string, unknown>) {
  const employeeNumber = requireText(body.employeeNumber, "Employee number", 32);
  const firstName = requireText(body.firstName, "First name");
  const lastName = requireText(body.lastName, "Last name");
  const email = requireEmail(body.email);
  const departmentId = optionalUuid(body.departmentId, "departmentId");
  const jobRoleId = optionalUuid(body.jobRoleId, "jobRoleId");
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
      role: "employee",
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
    console.error("Employee insert error:", insertError);
    throw new HttpError(500, "Could not create the employee record.");
  }

  const emp = created as EmployeeRow;

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
  if (!emp.is_active) throw new HttpError(400, "This employee is inactive.");
  if (!emp.email) {
    throw new HttpError(400, "This employee does not have an email address.");
  }

  if (emp.auth_user_id) {
    const { data: authData, error: authError } = await ctx.admin.auth.admin
      .getUserById(emp.auth_user_id);
    if (authError || !authData?.user) {
      throw new HttpError(500, "Could not check the employee's login account.");
    }
    if (authData.user.last_sign_in_at) {
      throw new HttpError(400, "This employee has already activated their account.");
    }
    // Account exists but was never used: re-sending the invite is safe.
    await sendInvite(ctx, emp, emp.email);
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

  await audit(ctx, "employee.invite_resend", emp.id,
    `Re-sent invitation to ${emp.first_name} ${emp.last_name}`, { email: emp.email });

  return { message: `Invitation sent to ${emp.email}`, employeeId: emp.id, created: false };
}

serve(async (req) => {
  const ctx = await requireCeo(req);
  const body = await readJson(req);

  if (body.employeeId !== undefined) {
    return await resendInvite(ctx, requireUuid(body.employeeId, "employeeId"));
  }
  return await createAndInvite(ctx, body);
});
