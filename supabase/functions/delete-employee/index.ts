import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Only POST requests are allowed." },
      405
    );
  }

  try {
    // ---------------------------------------------------------
    // 1. Get authorization header
    // ---------------------------------------------------------

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return jsonResponse(
        { error: "Missing authorization header." },
        401
      );
    }

    // ---------------------------------------------------------
    // 2. Get Supabase environment variables
    // ---------------------------------------------------------

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "Supabase URL or anon key is missing."
      );
    }

    if (!serviceRoleKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is missing."
      );
    }

    // ---------------------------------------------------------
    // 3. Create client using the logged-in CEO's token
    // ---------------------------------------------------------

    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    // ---------------------------------------------------------
    // 4. Verify the logged-in user
    // ---------------------------------------------------------

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse(
        { error: "You must be logged in." },
        401
      );
    }

    // ---------------------------------------------------------
    // 5. Create service-role client
    // ---------------------------------------------------------

    const adminSupabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // ---------------------------------------------------------
    // 6. Verify that caller is an active CEO
    // ---------------------------------------------------------

    const {
      data: ceoEmployee,
      error: ceoError,
    } = await adminSupabase
      .from("employees")
      .select("id, role, is_active")
      .eq("auth_user_id", user.id)
      .eq("role", "ceo")
      .eq("is_active", true)
      .maybeSingle();

    if (ceoError) {
      console.error(
        "CEO verification error:",
        ceoError
      );

      return jsonResponse(
        { error: "Could not verify CEO permissions." },
        500
      );
    }

    if (!ceoEmployee) {
      return jsonResponse(
        {
          error:
            "You do not have permission to delete employees.",
        },
        403
      );
    }

    // ---------------------------------------------------------
    // 7. Read request body
    // ---------------------------------------------------------

    let body;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { error: "Invalid JSON request." },
        400
      );
    }

    const employeeId = body?.employeeId;

    if (!employeeId) {
      return jsonResponse(
        { error: "employeeId is required." },
        400
      );
    }

    // ---------------------------------------------------------
    // 8. Find employee
    // ---------------------------------------------------------

    const {
      data: targetEmployee,
      error: employeeError,
    } = await adminSupabase
      .from("employees")
      .select(
        `
        id,
        employee_number,
        first_name,
        last_name,
        email,
        auth_user_id,
        role,
        is_active
        `
      )
      .eq("id", employeeId)
      .maybeSingle();

    if (employeeError) {
      console.error(
        "Employee lookup error:",
        employeeError
      );

      return jsonResponse(
        { error: "Could not find employee." },
        500
      );
    }

    if (!targetEmployee) {
      return jsonResponse(
        { error: "Employee not found." },
        404
      );
    }

    // ---------------------------------------------------------
    // 9. Prevent CEO self-deletion
    // ---------------------------------------------------------

    if (targetEmployee.id === ceoEmployee.id) {
      return jsonResponse(
        {
          error:
            "You cannot delete your own CEO account.",
        },
        400
      );
    }

    // ---------------------------------------------------------
    // 10. Prevent deleting another CEO
    // ---------------------------------------------------------

    if (targetEmployee.role === "ceo") {
      return jsonResponse(
        {
          error:
            "CEO accounts cannot be deleted here.",
        },
        400
      );
    }

    // ---------------------------------------------------------
    // 11. Save auth user ID before deleting employee
    // ---------------------------------------------------------

    const authUserId = targetEmployee.auth_user_id;

    const employeeName =
      `${targetEmployee.first_name} ${targetEmployee.last_name}`;

    // ---------------------------------------------------------
    // 12. DELETE EMPLOYEE ROW
    //
    // Because attendance.employee_id now uses
    // ON DELETE SET NULL, attendance records remain.
    // ---------------------------------------------------------

    const {
      error: deleteEmployeeError,
    } = await adminSupabase
      .from("employees")
      .delete()
      .eq("id", targetEmployee.id);

    if (deleteEmployeeError) {
      console.error(
        "Employee deletion error:",
        deleteEmployeeError
      );

      return jsonResponse(
        {
          error:
            "Could not delete the employee record.",
        },
        500
      );
    }

    // ---------------------------------------------------------
    // 13. Delete Supabase Auth account
    // ---------------------------------------------------------

    if (authUserId) {
      const {
        error: deleteAuthError,
      } = await adminSupabase.auth.admin.deleteUser(
        authUserId
      );

      if (deleteAuthError) {
        console.error(
          "Auth user deletion error:",
          deleteAuthError
        );

        return jsonResponse(
          {
            error:
              "The employee record was deleted, but the login account could not be deleted. Please remove the remaining Auth account manually.",
            employeeDeleted: true,
            authUserDeleted: false,
          },
          500
        );
      }
    }

    // ---------------------------------------------------------
    // 14. Success
    // ---------------------------------------------------------

    return jsonResponse({
      success: true,
      message:
        `${employeeName} was completely deleted.`,
      employeeId: targetEmployee.id,
      employeeDeleted: true,
      authUserDeleted: !!authUserId,
      attendanceHistoryPreserved: true,
    });
  } catch (error) {
    console.error(
      "Unexpected delete employee error:",
      error
    );

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error.",
      },
      500
    );
  }
});