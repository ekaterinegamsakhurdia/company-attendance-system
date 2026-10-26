// Permanently deletes an employee (hard delete) in an order that can always
// be retried and never leaves a working login without an employee record:
//
//   1. deactivate the employee   -> access is cut off immediately
//   2. delete the login account  -> employees.auth_user_id is set to NULL
//                                   by the foreign key (see migration)
//   3. delete the employee row   -> attendance history stays (employee_id
//                                   becomes NULL; name/number are snapshotted)
//
// If any step fails the employee simply stays inactive and the CEO can press
// Delete again.
import {
  audit,
  HttpError,
  readJson,
  requireCeo,
  requireUuid,
  serve,
} from "../_shared/common.ts";

serve(async (req) => {
  const ctx = await requireCeo(req);
  const body = await readJson(req);
  const employeeId = requireUuid(body.employeeId, "employeeId");

  const { data: target, error: lookupError } = await ctx.admin
    .from("employees")
    .select("id, employee_number, first_name, last_name, email, auth_user_id, role, is_active")
    .eq("id", employeeId)
    .maybeSingle();

  if (lookupError) {
    console.error("Employee lookup error:", lookupError);
    throw new HttpError(500, "Could not look up the employee.");
  }
  if (!target) throw new HttpError(404, "Employee not found.");
  if (target.id === ctx.ceoEmployeeId) {
    throw new HttpError(400, "You cannot delete your own account.");
  }
  // Developer accounts do not exist as far as a CEO is concerned.
  if (target.role === "developer" && !ctx.isDeveloper) {
    throw new HttpError(404, "Employee not found.");
  }
  if (target.role === "ceo" && !ctx.isDeveloper) {
    throw new HttpError(403, "Only a developer can delete a CEO account.");
  }

  const name = `${target.first_name} ${target.last_name}`;

  // 1. Cut off access first.
  if (target.is_active) {
    const { error } = await ctx.admin
      .from("employees")
      .update({ is_active: false })
      .eq("id", target.id);
    if (error) {
      console.error("Deactivate error:", error);
      throw new HttpError(500, "Could not deactivate the employee. Nothing was deleted.");
    }
  }

  // Profile photos live in avatars/<auth_user_id>/. Remove them (best effort:
  // a leftover photo never blocks the deletion and cannot be reached any more).
  if (target.auth_user_id) {
    try {
      const folder = target.auth_user_id as string;
      const { data: files } = await ctx.admin.storage.from("avatars").list(folder, { limit: 100 });
      const paths = (files ?? []).map((f: { name: string }) => `${folder}/${f.name}`);
      if (paths.length) await ctx.admin.storage.from("avatars").remove(paths);
    } catch (e) {
      console.error("Avatar cleanup error (ignored):", e);
    }
  }

  // 2. Remove the login.
  if (target.auth_user_id) {
    const { error } = await ctx.admin.auth.admin.deleteUser(target.auth_user_id);
    const alreadyGone = error?.message?.toLowerCase().includes("not found");
    if (error && !alreadyGone) {
      console.error("Auth user deletion error:", error);
      throw new HttpError(
        500,
        "The login account could not be deleted, so the employee was only deactivated. Press Delete again to retry.",
        { deactivated: true, deleted: false },
      );
    }
  }

  // 3. Remove the employee record.
  const { error: deleteError } = await ctx.admin
    .from("employees")
    .delete()
    .eq("id", target.id);
  if (deleteError) {
    console.error("Employee deletion error:", deleteError);
    throw new HttpError(
      500,
      "The login was removed but the employee record could not be deleted. Press Delete again to retry.",
      { deactivated: true, deleted: false },
    );
  }

  // The row is gone, so employee_id is null here; details live in metadata.
  await audit(ctx, "employee.delete", null, `Deleted ${name}`, {
    employee_id: target.id,
    employee_number: target.employee_number,
    role: target.role,
    name,
    email: target.email,
    had_login: Boolean(target.auth_user_id),
  });

  return {
    message: `${name} was deleted. Their attendance history was kept.`,
    employeeId: target.id,
    attendanceHistoryPreserved: true,
  };
});
