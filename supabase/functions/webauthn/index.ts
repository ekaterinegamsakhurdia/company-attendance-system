// Biometric (Face ID / fingerprint) check for clock-in and clock-out.
//
//   register-options -> register-verify   enrol this device (needs the account password)
//   auth-options     -> auth-verify       prove presence right before clocking in/out
//
// auth-verify returns a one-time `verificationId`. The database functions
// clock_in(p_verification) / clock_out(p_verification) consume it, so a stolen
// session alone can never clock in on its own.
import { createClient } from "@supabase/supabase-js";
import {
  allowedOrigins,
  audit,
  HttpError,
  readJson,
  requireEmployee,
  requireText,
  serve,
  type EmployeeContext,
} from "../_shared/common.ts";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  checkAuthentication,
  checkRegistration,
  rpConfigFrom,
} from "../_shared/webauthn.ts";

const MAX_DEVICES = 3;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type Purpose = "register" | "clock_in" | "clock_out";

function rp() {
  try {
    return rpConfigFrom(allowedOrigins(), Deno.env.get("WEBAUTHN_RP_ID") ?? undefined);
  } catch (err) {
    console.error(err);
    throw new HttpError(
      500,
      "Biometric check is not configured on the server (SITE_URL is missing).",
    );
  }
}

function requireAction(value: unknown): "clock_in" | "clock_out" {
  if (value !== "clock_in" && value !== "clock_out") {
    throw new HttpError(400, "action must be clock_in or clock_out.");
  }
  return value;
}

// Re-checks the account password so that a hijacked session cannot enrol a new device.
async function verifyPassword(ctx: EmployeeContext, password: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon || !ctx.user.email) {
    throw new HttpError(500, "Server is not configured correctly.");
  }
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: ctx.user.email,
    password,
  });
  if (error) throw new HttpError(403, "That password is not correct.");
  // 'local' ends only this throw-away session, never the user's real ones.
  await client.auth.signOut({ scope: "local" }).catch(() => {});
}

async function storeChallenge(ctx: EmployeeContext, purpose: Purpose, challenge: string) {
  // One open challenge per employee+purpose.
  await ctx.admin
    .from("webauthn_challenges")
    .delete()
    .eq("employee_id", ctx.employee.id)
    .eq("purpose", purpose);
  const { error } = await ctx.admin
    .from("webauthn_challenges")
    .insert({ employee_id: ctx.employee.id, purpose, challenge });
  if (error) {
    console.error("Challenge insert error:", error);
    throw new HttpError(500, "Could not start the verification.");
  }
}

// Single use: the challenge is deleted whether or not verification succeeds.
async function consumeChallenge(ctx: EmployeeContext, purpose: Purpose): Promise<string> {
  const { data, error } = await ctx.admin
    .from("webauthn_challenges")
    .select("id, challenge, created_at")
    .eq("employee_id", ctx.employee.id)
    .eq("purpose", purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Challenge lookup error:", error);
    throw new HttpError(500, "Could not complete the verification.");
  }
  if (!data) throw new HttpError(400, "Verification was not started. Please try again.");

  await ctx.admin
    .from("webauthn_challenges")
    .delete()
    .eq("employee_id", ctx.employee.id)
    .eq("purpose", purpose);

  if (Date.now() - new Date(data.created_at).getTime() > CHALLENGE_TTL_MS) {
    throw new HttpError(400, "The verification expired. Please try again.");
  }
  return data.challenge;
}

async function listCredentials(ctx: EmployeeContext) {
  const { data, error } = await ctx.admin
    .from("webauthn_credentials")
    .select("id, credential_id, public_key, counter, transports")
    .eq("employee_id", ctx.employee.id);
  if (error) {
    console.error("Credential lookup error:", error);
    throw new HttpError(500, "Could not load your registered devices.");
  }
  return data ?? [];
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value as Record<string, unknown>;
}

serve(async (req) => {
  const ctx = await requireEmployee(req);
  const body = await readJson(req);
  const config = rp();

  switch (body.step) {
    case "register-options": {
      await verifyPassword(ctx, requireText(body.password, "Password", 200));
      const existing = await listCredentials(ctx);
      if (existing.length >= MAX_DEVICES) {
        throw new HttpError(
          400,
          `You can register at most ${MAX_DEVICES} devices. Remove one first.`,
        );
      }
      const options = await buildRegistrationOptions(
        config,
        {
          id: ctx.employee.id,
          name: ctx.user.email ?? ctx.employee.employee_number,
          displayName: `${ctx.employee.first_name} ${ctx.employee.last_name}`,
        },
        existing,
      );
      await storeChallenge(ctx, "register", options.challenge);
      return { options };
    }

    case "register-verify": {
      const deviceName = requireText(body.deviceName ?? "My device", "Device name", 80);
      const response = requireObject(body.response, "response");
      const challenge = await consumeChallenge(ctx, "register");

      let info;
      try {
        // deno-lint-ignore no-explicit-any
        info = await checkRegistration(config, response as any, challenge);
      } catch (err) {
        console.error("Registration verification failed:", (err as Error).message);
        throw new HttpError(400, "This device could not be verified. Please try again.");
      }
      if (!info) throw new HttpError(400, "This device could not be verified.");

      const { data: inserted, error } = await ctx.admin
        .from("webauthn_credentials")
        .insert({ employee_id: ctx.employee.id, device_name: deviceName, ...info })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") {
          throw new HttpError(409, "This device is already registered.");
        }
        console.error("Credential insert error:", error);
        throw new HttpError(500, "Could not save the device.");
      }
      await audit(ctx, "webauthn.register", ctx.employee.id, `Biometric device added: ${deviceName}`, {
        credential_row_id: inserted.id,
        device_name: deviceName,
      });
      return { message: "Device registered.", credentialRowId: inserted.id };
    }

    case "auth-options": {
      const action = requireAction(body.action);
      const creds = await listCredentials(ctx);
      if (creds.length === 0) {
        throw new HttpError(
          400,
          "No Face ID / fingerprint device is registered for your account yet.",
          { code: "no_device" },
        );
      }
      const options = await buildAuthenticationOptions(config, creds);
      await storeChallenge(ctx, action, options.challenge);
      return { options };
    }

    case "auth-verify": {
      const action = requireAction(body.action);
      const response = requireObject(body.response, "response");
      const credentialId = typeof response.id === "string" ? response.id : "";
      const challenge = await consumeChallenge(ctx, action);

      // The credential must belong to the caller, not just exist.
      const creds = await listCredentials(ctx);
      const stored = creds.find((c) => c.credential_id === credentialId);
      if (!stored) {
        throw new HttpError(403, "This device is not registered for your account.");
      }

      let result;
      try {
        // deno-lint-ignore no-explicit-any
        result = await checkAuthentication(config, response as any, challenge, stored);
      } catch (err) {
        console.error("Authentication verification failed:", (err as Error).message);
        await audit(ctx, "webauthn.auth_failed", ctx.employee.id, "Biometric check failed", {
          action,
        });
        throw new HttpError(403, "Verification failed. Please try again.");
      }
      if (!result.verified) throw new HttpError(403, "Verification failed.");

      await ctx.admin
        .from("webauthn_credentials")
        .update({ counter: result.newCounter, last_used_at: new Date().toISOString() })
        .eq("id", stored.id);

      const { data: token, error } = await ctx.admin
        .from("biometric_verifications")
        .insert({ employee_id: ctx.employee.id, action, credential_id: stored.id })
        .select("id")
        .single();
      if (error) {
        console.error("Verification insert error:", error);
        throw new HttpError(500, "Could not complete the verification.");
      }
      return { verificationId: token.id, expiresInSeconds: 120 };
    }

    default:
      throw new HttpError(400, "Unknown step.");
  }
});
