// Decisions for the "send login link" button, kept free of Deno / Supabase imports so they can be unit-tested.

/**
 * 'invite': the person never signed in, so (re-)send the invitation.
 * 'reset':  the person has an account that was used (or opened), so send a password-reset link.
 *           This is the case that matters: somebody who forgot their password.
 */
export function planResend(authUser) {
  return authUser && authUser.last_sign_in_at ? 'reset' : 'invite';
}

/** The auth server refuses to invite an address that is already a registered user. */
export function isAlreadyRegistered(message) {
  return /already (been )?registered|already exists|email_exists|user_already_exists/i.test(String(message ?? ''));
}

const RATE_LIMIT = /rate limit|only request this after|too many|over_email_send_rate_limit/i;

/** Is this a "slow down" error (HTTP 429) rather than a real failure? */
export const isRateLimit = (message) => RATE_LIMIT.test(String(message ?? ''));

/** Plain-language version of the mail provider's errors; the original message otherwise. */
export function friendlyMailError(message) {
  if (isRateLimit(message)) {
    return 'An e-mail was sent to this address a moment ago. Please wait a minute and try again.';
  }
  return String(message ?? '') || 'The e-mail could not be sent.';
}
