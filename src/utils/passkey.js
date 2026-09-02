'use client';

/**
 * Browser side of passkey (WebAuthn) auth.
 *
 * The three-step dance is intentionally explicit:
 *
 *   1. POST /api/auth/webauthn/authenticate/options  → random challenge
 *   2. startAuthentication()                         → authenticator signs it
 *   3. POST /api/auth/webauthn/authenticate/verify   → server verifies, returns
 *      a single-use ticket, which we hand to NextAuth's `webauthn` provider to
 *      mint the session.
 *
 * CSRF is handled by the global fetch shim (src/utils/csrfClient.js), which
 * attaches the header to every same-origin state-changing request — including
 * these — without any per-call wiring.
 */

import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { signIn } from 'next-auth/react';

export function passkeysSupported() {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** Friendly error for the common abort case. */
function explainError(err) {
  if (err?.name === 'NotAllowedError') return 'The passkey prompt was cancelled or timed out.';
  if (err?.name === 'SecurityError') return 'This page is not allowed to use passkeys (check HTTPS / origin).';
  return err?.message || 'Passkey operation failed.';
}

/**
 * Sign in with a passkey. Resolves after a full navigation on success, or
 * throws with a user-readable message.
 *
 * @param {object} [opts]
 * @param {string} [opts.callbackUrl]
 */
export async function signInWithPasskey({ callbackUrl = '/' } = {}) {
  // 1. Challenge
  const optionsRes = await fetch('/api/auth/webauthn/authenticate/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const optionsBody = await optionsRes.json().catch(() => null);
  if (!optionsRes.ok || !optionsBody?.success) {
    throw new Error(optionsBody?.error || 'Could not start passkey sign-in.');
  }

  // 2. Ask the authenticator to sign.
  let assertion;
  try {
    assertion = await startAuthentication({ optionsJSON: optionsBody.data });
  } catch (err) {
    throw new Error(explainError(err));
  }

  // 3. Server verification → one-time ticket.
  const verifyRes = await fetch('/api/auth/webauthn/authenticate/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: assertion }),
  });
  const verifyBody = await verifyRes.json().catch(() => null);
  if (!verifyRes.ok || !verifyBody?.success) {
    throw new Error(verifyBody?.error || 'Passkey sign-in failed.');
  }

  // 4. Redeem the ticket for a NextAuth session.
  const result = await signIn('webauthn', {
    ticket: verifyBody.data.ticket,
    redirect: false,
    callbackUrl,
  });
  if (result?.error) throw new Error(result.error === 'CredentialsSignin' ? 'Passkey sign-in failed.' : result.error);
  window.location.href = result?.url || callbackUrl;
}

/**
 * Register a new passkey on the signed-in account.
 *
 * @returns {Promise<void>} resolves when the credential is stored
 */
export async function registerPasskey() {
  const optionsRes = await fetch('/api/auth/webauthn/register/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const optionsBody = await optionsRes.json().catch(() => null);
  if (!optionsRes.ok || !optionsBody?.success) {
    throw new Error(optionsBody?.error || 'Could not start passkey registration.');
  }

  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON: optionsBody.data });
  } catch (err) {
    throw new Error(explainError(err));
  }

  const verifyRes = await fetch('/api/auth/webauthn/register/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: attestation }),
  });
  const verifyBody = await verifyRes.json().catch(() => null);
  if (!verifyRes.ok || !verifyBody?.success) {
    throw new Error(verifyBody?.error || 'Passkey registration failed.');
  }
}
