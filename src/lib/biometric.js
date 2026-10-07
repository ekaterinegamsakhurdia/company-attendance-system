// Browser side of the Face ID / fingerprint check (WebAuthn platform authenticator).
// The private key never leaves the phone/laptop; the server only verifies a signature.
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { webauthnStep } from '../services/api';

export async function biometricSupport() {
  if (!browserSupportsWebAuthn()) return { supported: false, reason: 'This browser does not support Face ID / fingerprint sign-in.' };
  if (!(await platformAuthenticatorIsAvailable())) {
    return {
      supported: false,
      reason: 'This device has no Face ID, fingerprint or screen lock set up. Enable one in the device settings.',
    };
  }
  return { supported: true, reason: '' };
}

function friendly(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return new Error('Verification was cancelled or timed out. Please try again.');
    case 'InvalidStateError':
      return new Error('This device is already registered.');
    case 'SecurityError':
      return new Error('Biometric sign-in only works on the official https site address.');
    case 'AbortError':
      return new Error('Verification was interrupted. Please try again.');
    default:
      return err instanceof Error ? err : new Error('Verification failed.');
  }
}

/** Guess a readable default name for the device being enrolled. */
export function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux PC';
  return 'My device';
}

export async function registerThisDevice(password, deviceName) {
  const { options } = await webauthnStep('register-options', { password });
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (err) {
    throw friendly(err);
  }
  return webauthnStep('register-verify', { response, deviceName });
}

/** Prompts Face ID / fingerprint and returns the one-time id the database needs. */
export async function verifyBiometric(action) {
  const { options } = await webauthnStep('auth-options', { action });
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (err) {
    throw friendly(err);
  }
  const { verificationId } = await webauthnStep('auth-verify', { action, response });
  return verificationId;
}
