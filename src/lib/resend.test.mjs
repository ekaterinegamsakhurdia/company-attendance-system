import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyMailError, isAlreadyRegistered, isRateLimit, planResend } from '../../supabase/functions/_shared/resend.js';

test('someone who has signed in gets a password-reset link, a new person gets the invitation', () => {
  assert.equal(planResend({ last_sign_in_at: '2026-10-01T10:00:00Z' }), 'reset');
  assert.equal(planResend({ last_sign_in_at: null }), 'invite');
  assert.equal(planResend({}), 'invite');
  assert.equal(planResend(null), 'invite');
});

test('"already registered" errors are recognised so the reset link can be used instead', () => {
  assert.ok(isAlreadyRegistered('A user with this email address has already been registered'));
  assert.ok(isAlreadyRegistered('User already registered'));
  assert.ok(isAlreadyRegistered('email_exists'));
  assert.ok(!isAlreadyRegistered('SMTP failure'));
  assert.ok(!isAlreadyRegistered(undefined));
});

test('rate-limit errors become a plain message and 429; other errors stay as they are', () => {
  const raw = 'For security purposes, you can only request this after 52 seconds.';
  assert.ok(isRateLimit(raw));
  assert.ok(isRateLimit('email rate limit exceeded'));
  assert.match(friendlyMailError(raw), /wait a minute/);
  assert.ok(!isRateLimit('Invalid email'));
  assert.equal(friendlyMailError('Invalid email'), 'Invalid email');
  assert.equal(friendlyMailError(''), 'The e-mail could not be sent.');
});
