// Developer only: changes the e-mail address of an employee, in the employee
// record AND on the login account, so the two never disagree.
//
// Body: { employeeId, email }
//
// Order: employee row first (it has the unique check), then the login.
// If the login update fails the employee row is put back.
import {
  audit,
  HttpError,
  readJson,
  requireDeveloper,
  requireEmail,
  requireUuid,
  serve,
} from "../_shared/common.ts";

serve(async (req) => {
  const ctx = await requireDeveloper(req);
  const body = await readJson(req);
  const employeeId = requireUuid(body.employeeId, "employeeId");
  const email = requireEmail(body.email);

  const { data: target, error: lookupError } = await ctx.admin
    .from("employees")
    .select("id, first_name, last_name, email, auth_user_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (lookupError) {
    console.error("Employee lookup error:", lookupError);
    throw new HttpError(500, "Could not look up the employee.");
  }
  if (!target) throw new HttpError(404, "Employee not found.");

  const oldEmail: string | null = target.email;
  if (oldEmail && oldEmail.toLowerCase() === email.toLowerCase()) {
    throw new HttpError(400, "That is already this person's e-mail address.");
  }

  const { error: updateError } = await ctx.admin
    .from("employees")
    .update({ email })
    .eq("id", target.id);
  if (updateError) {
    if (updateError.code === "23505") {
      throw new HttpError(409, "An employee with this email already exists.");
    }
    console.error("Employee email update error:", updateError);
    throw new HttpError(500, "Could not change the e-mail address.");
  }

  let activated = false;
  if (target.auth_user_id) {
    const { data: before } = await ctx.admin.auth.admin.getUserById(target.auth_user_id);
    activated = Boolean(before?.user?.last_sign_in_at);

    const { error: authError } = await ctx.admin.auth.admin.updateUserById(
      target.auth_user_id,
      { email, email_confirm: true },
    );
    if (authError) {
      console.error("Auth email update error:", authError.message);
      await ctx.admin.from("employees").update({ email: oldEmail }).eq("id", target.id);
      throw new HttpError(400, authError.message || "The login e-mail could not be changed.");
    }
  }

  await audit(ctx, "employee.email", target.id,
    `Changed e-mail of ${target.first_name} ${target.last_name}`,
    { old_email: oldEmail, new_email: email, had_login: Boolean(target.auth_user_id) });

  return {
    message: !target.auth_user_id
      ? "E-mail changed. They have not been invited yet; the invitation will go to the new address."
      : !activated
      ? "E-mail changed. They have not activated their account yet, so press Send login link to send it to the new address."
      : "E-mail changed. They now log in with the new address.",
    employeeId: target.id,
  };
});
