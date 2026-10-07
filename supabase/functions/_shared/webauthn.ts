// WebAuthn (Face ID / Touch ID / Windows Hello / Android fingerprint) helpers.
//
// Only the *platform* authenticator of the device is accepted and the browser
// must perform user verification (biometric or the device PIN/passcode).
// Nothing biometric ever reaches the server: it only sees a signed assertion.
// Kept free of database / HTTP code so it can be tested on its own.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

export type RpConfig = { rpID: string; rpName: string; origins: string[] };

export type StoredCredential = {
  credential_id: string; // base64url
  public_key: string; // base64url (COSE)
  counter: number;
  transports: string[] | null;
};

export function rpConfigFrom(
  origins: string[],
  rpIdOverride?: string,
  rpName = "Looper Agency",
): RpConfig {
  if (origins.length === 0) {
    throw new Error("No allowed origin configured (set SITE_URL or ALLOWED_ORIGINS).");
  }
  return {
    rpID: rpIdOverride || new URL(origins[0]).hostname,
    rpName,
    origins,
  };
}

const asTransports = (t: string[] | null | undefined) =>
  (t ?? undefined) as AuthenticatorTransport[] | undefined;

export function buildRegistrationOptions(
  rp: RpConfig,
  user: { id: string; name: string; displayName: string },
  existing: { credential_id: string; transports: string[] | null }[],
) {
  return generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.name,
    userDisplayName: user.displayName,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: asTransports(c.transports),
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    },
    timeout: 60_000,
  });
}

export async function checkRegistration(
  rp: RpConfig,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
) {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origins,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo) return null;
  const { credential } = result.registrationInfo;
  return {
    credential_id: credential.id,
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: (credential.transports ?? response.response.transports ?? null) as
      | string[]
      | null,
  };
}

export function buildAuthenticationOptions(
  rp: RpConfig,
  credentials: { credential_id: string; transports: string[] | null }[],
) {
  return generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: credentials.map((c) => ({
      id: c.credential_id,
      transports: asTransports(c.transports),
    })),
    userVerification: "required",
    timeout: 60_000,
  });
}

export async function checkAuthentication(
  rp: RpConfig,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  stored: StoredCredential,
) {
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origins,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    credential: {
      id: stored.credential_id,
      publicKey: isoBase64URL.toBuffer(stored.public_key),
      counter: Number(stored.counter),
      transports: asTransports(stored.transports),
    },
  });
  return { verified: result.verified, newCounter: result.authenticationInfo.newCounter };
}
