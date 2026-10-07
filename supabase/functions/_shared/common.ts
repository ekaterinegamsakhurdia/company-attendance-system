// Shared helpers for Looper Edge Functions: CORS, error handling, CEO auth, audit.
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

export class HttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------------------------------------------------------------------
// CORS: only the configured site(s) may call these functions from a browser.
// Set ALLOWED_ORIGINS (comma separated) or SITE_URL as a function secret.
// ---------------------------------------------------------------------
export function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("SITE_URL") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const allowed = allowedOrigins();
  const origin = req.headers.get("Origin");
  if (allowed.length === 0) {
    // Not configured: stay permissive but make it visible in the logs.
    console.warn("ALLOWED_ORIGINS / SITE_URL not set: CORS is open.");
    base["Access-Control-Allow-Origin"] = "*";
  } else if (origin && allowed.includes(origin.replace(/\/+$/, ""))) {
    base["Access-Control-Allow-Origin"] = origin;
  }
  return base;
}

export function json(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------
// Request wrapper: OPTIONS, POST-only, uniform error responses.
// Unexpected errors are logged but never leaked to the client.
// ---------------------------------------------------------------------
export function serve(
  handler: (req: Request) => Promise<Record<string, unknown>>,
) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders(req) });
    }
    if (req.method !== "POST") {
      return json(req, { error: "Only POST requests are allowed." }, 405);
    }
    try {
      const result = await handler(req);
      return json(req, { success: true, ...result });
    } catch (err) {
      if (err instanceof HttpError) {
        return json(req, { error: err.message, ...(err.extra ?? {}) }, err.status);
      }
      console.error("Unexpected error:", err);
      return json(req, { error: "Unexpected server error." }, 500);
    }
  });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
}

// ---------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new HttpError(400, `${field} must be a valid id.`);
  }
  return value;
}

export function requireText(value: unknown, field: string, max = 100): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required.`);
  }
  const v = value.trim();
  if (v.length > max) {
    throw new HttpError(400, `${field} must be at most ${max} characters.`);
  }
  return v;
}

export function requireEmail(value: unknown): string {
  const v = requireText(value, "Email", 254).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new HttpError(400, "Email is not valid.");
  return v;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireUuid(value, field);
}

// ---------------------------------------------------------------------
// Auth: verifies the caller's JWT with Supabase Auth, then loads their
// active employee record. The service-role client is only handed out after
// both checks pass.
// ---------------------------------------------------------------------
export type AuthContext = {
  admin: SupabaseClient;
  user: User;
  ip: string | null;
};

export type EmployeeContext = AuthContext & {
  employee: {
    id: string;
    employee_number: string;
    first_name: string;
    last_name: string;
    role: string;
  };
};

export type CeoContext = AuthContext & { ceoEmployeeId: string };

export function clientIp(req: Request): string | null {
  const raw =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  return raw && raw.length > 0 ? raw : null;
}

async function authenticate(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "Missing authorization header.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
    throw new HttpError(500, "Server is not configured correctly.");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(
    match[1],
  );
  if (userError || !userData?.user) {
    throw new HttpError(401, "You must be logged in.");
  }
  return { admin, user: userData.user, ip: clientIp(req) };
}

export async function requireEmployee(req: Request): Promise<EmployeeContext> {
  const base = await authenticate(req);
  const { data, error } = await base.admin
    .from("employees")
    .select("id, employee_number, first_name, last_name, role")
    .eq("auth_user_id", base.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("Employee lookup error:", error);
    throw new HttpError(500, "Could not load your employee profile.");
  }
  if (!data) throw new HttpError(403, "No active employee profile for this account.");
  return { ...base, employee: data };
}

export async function requireCeo(req: Request): Promise<CeoContext> {
  const ctx = await requireEmployee(req);
  if (ctx.employee.role !== "ceo") {
    throw new HttpError(403, "Only the CEO can do this.");
  }
  return { admin: ctx.admin, user: ctx.user, ip: ctx.ip, ceoEmployeeId: ctx.employee.id };
}

export async function audit(
  ctx: AuthContext,
  action: string,
  employeeId: string | null,
  description: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await ctx.admin.from("audit_logs").insert({
    actor_user_id: ctx.user.id,
    employee_id: employeeId,
    action,
    description,
    ip_address: ctx.ip,
    metadata,
  });
  // An audit failure must not undo a completed action, but it must be visible.
  if (error) console.error("Audit log insert failed:", error.message);
}
