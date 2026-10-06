import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // ---------------------------------------------------------
  // CORS
  // ---------------------------------------------------------
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    // ---------------------------------------------------------
    // 1. Get Authorization header
    // ---------------------------------------------------------
    const authHeader = req.headers.get("Authorization");

    console.log(
      "Authorization header present:",
      !!authHeader
    );

    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: "Missing authorization header.",
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // 2. Supabase environment variables
    // ---------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    );

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "SUPABASE_URL or SUPABASE_ANON_KEY is missing."
      );
    }

    if (!serviceRoleKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is missing."
      );
    }

    // ---------------------------------------------------------
    // 3. Client using the logged-in user's JWT
    // ---------------------------------------------------------
    const userSupabase = createClient(
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
    // 4. Get currently authenticated user
    // ---------------------------------------------------------
    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser();

    console.log(
      "Authenticated user:",
      user?.id ?? "NONE"
    );

    if (userError) {
      console.error(
        "Authentication error:",
        userError
      );

      return new Response(
        JSON.stringify({
          error: "Authentication failed.",
          details: userError.message,
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!user) {
      return new Response(
        JSON.stringify({
          error: "You must be logged in.",
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // 5. Admin client
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
    // 6. Verify CEO
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
        "CEO check error:",
        ceoError
      );

      return new Response(
        JSON.stringify({
          error: "Could not verify CEO permissions.",
          details: ceoError.message,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!ceoEmployee) {
      console.error(
        "User is not an active CEO:",
        user.id
      );

      return new Response(
        JSON.stringify({
          error:
            "You do not have permission to invite employees.",
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // 7. Read request body
    // ---------------------------------------------------------
    const body = await req.json();
    const employeeId = body?.employeeId;

    if (!employeeId) {
      return new Response(
        JSON.stringify({
          error: "employeeId is required.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // 8. Find employee
    // ---------------------------------------------------------
    const {
      data: employee,
      error: employeeError,
    } = await adminSupabase
      .from("employees")
      .select(
        "id, employee_number, first_name, last_name, email, auth_user_id, is_active"
      )
      .eq("id", employeeId)
      .maybeSingle();

    if (employeeError) {
      console.error(
        "Employee lookup error:",
        employeeError
      );

      return new Response(
        JSON.stringify({
          error: "Could not find employee.",
          details: employeeError.message,
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!employee) {
      return new Response(
        JSON.stringify({
          error: "Employee not found.",
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // 9. Check email
    // ---------------------------------------------------------
    if (!employee.email) {
      return new Response(
        JSON.stringify({
          error:
            "This employee does not have an email address.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // 10. Check existing Auth account
    // ---------------------------------------------------------
    if (employee.auth_user_id) {
      return new Response(
        JSON.stringify({
          error:
            "This employee already has an account.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // 11. Invitation redirect
    // ---------------------------------------------------------
    const siteUrl =
      Deno.env.get("SITE_URL") ||
      "http://localhost:5173";

    const redirectTo =
      `${siteUrl}/set-password`;

    console.log(
      "Sending invitation to:",
      employee.email
    );

    console.log(
      "Redirect URL:",
      redirectTo
    );

    // ---------------------------------------------------------
    // 12. Send invitation
    // ---------------------------------------------------------
    const {
      data: invitedUser,
      error: inviteError,
    } =
      await adminSupabase.auth.admin.inviteUserByEmail(
        employee.email,
        {
          data: {
            employee_id: employee.id,
            employee_number:
              employee.employee_number,
            first_name: employee.first_name,
            last_name: employee.last_name,
          },
          redirectTo,
        }
      );

    if (inviteError) {
      console.error(
        "Invite error:",
        inviteError
      );

      return new Response(
        JSON.stringify({
          error: inviteError.message,
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!invitedUser?.user?.id) {
      return new Response(
        JSON.stringify({
          error:
            "Invitation was created but no user ID was returned.",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // 13. Link Auth user to employee
    // ---------------------------------------------------------
    const {
      error: updateError,
    } = await adminSupabase
      .from("employees")
      .update({
        auth_user_id:
          invitedUser.user.id,
      })
      .eq("id", employee.id);

    if (updateError) {
      console.error(
        "Employee linking error:",
        updateError
      );

      return new Response(
        JSON.stringify({
          error:
            "Account was created, but the employee could not be linked.",
          details: updateError.message,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // 14. Success
    // ---------------------------------------------------------
    console.log(
      "Invitation successfully sent:",
      employee.email
    );

    return new Response(
      JSON.stringify({
        success: true,
        message:
          `Invitation sent to ${employee.email}`,
        userId:
          invitedUser.user.id,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "Unexpected error:",
      error
    );

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error.",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
