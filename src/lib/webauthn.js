import mongoose from 'mongoose';
import crypto from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import WebAuthnCredential from '@/models/WebAuthnCredential';

/**
 * WebAuthn / passkey support.
 *
 * Two flows live here:
 *
 *  REGISTER    — an already-authenticated user adds a passkey to their account.
 *                Requires a session; never usable to create an account.
 *
 *  AUTHENTICATE— a signed-out user proves possession of a passkey. Because the
 *                browser refuses to use a credential on the wrong origin, this
 *                is resistant to phishing in a way no password flow can be.
 *
 * Challenge handling
 * ------------------
 * A challenge is only meaningful if the server can remember what it issued. It
 * is stored in Mongo against a random id held in an HttpOnly cookie, not in the
 * session: the whole point of the authentication flow is that there is no
 * session yet. Mongo (rather than a process-local Map) means the flow survives
 * a restart and works when more than one instance is serving.
 */

const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Monitor';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TICKET_TTL_MS = 60 * 1000;

function getRpConfig() {
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.AUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!base && !process.env.WEBAUTHN_RP_ID) {
    throw new Error(
      'WebAuthn requires NEXTAUTH_URL (or explicit WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN).'
    );
  }

  let origin = process.env.WEBAUTHN_ORIGIN;
  let rpID = process.env.WEBAUTHN_RP_ID;
  if (!origin && base) origin = new URL(base).origin;
  if (!rpID && origin) rpID = new URL(origin).hostname;

  return { rpID, origin, rpName: RP_NAME };
}

export const WEBAUTHN_CHALLENGE_COOKIE = 'wa_challenge';
export const WEBAUTHN_TICKET_COOKIE = null; // ticket is returned in the body

export function challengeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/webauthn',
    maxAge: Math.floor(CHALLENGE_TTL_MS / 1000),
  };
}

// --- Challenge store --------------------------------------------------------

async function challengeCollection() {
  const db = mongoose.connection?.db;
  if (!db) throw new Error('Database not connected');
  const col = db.collection('webauthn_challenges');
  await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: CHALLENGE_TTL_MS / 1000 }).catch(() => {});
  return col;
}

/**
 * Issue a challenge and return it along with the id to store in the cookie.
 * @param {string} purpose 'register' | 'authenticate'
 * @param {string|null} userId
 */
export async function issueChallenge(purpose, userId = null) {
  const challenge = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomBytes(24).toString('base64url');
  const col = await challengeCollection();
  await col.insertOne({ _id: id, challenge, purpose, userId: userId || null, createdAt: new Date() });
  return { id, challenge };
}

/**
 * Consume a challenge. Single-use: it is deleted on read so a captured
 * response cannot be replayed against the same challenge.
 */
export async function consumeChallenge(id, purpose) {
  if (!id) return null;
  const col = await challengeCollection();
  const doc = await col.findOneAndDelete({ _id: id, purpose });
  if (!doc) return null;
  if (Date.now() - new Date(doc.createdAt).getTime() > CHALLENGE_TTL_MS) return null;
  return doc;
}

// --- Registration -----------------------------------------------------------

/**
 * @param {object} user
 * @param {string} challenge  MUST be the value persisted server-side; if it is
 *   omitted the library generates its own and verification will never match.
 */
export async function buildRegistrationOptions(user, challenge) {
  const { rpID, rpName, origin } = getRpConfig();

  const existing = await WebAuthnCredential.find({ userId: String(user._id) }).lean();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    // Our challenge, not the library's default — otherwise the value stored in
    // Mongo and the value the authenticator signs are two different strings.
    challenge,
    userName: user.email,
    userDisplayName: user.name || user.email,
    // Stable, opaque handle. Not derived from the email so that it does not
    // become a cross-service correlation identifier.
    userID: crypto.createHash('sha256').update(String(user._id)).digest(),
    // Suppress re-registering an authenticator the user already has.
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports || [],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    // 'none' keeps registration frictionless and avoids transmitting
    // attestation data we have no use for.
    attestationType: 'none',
  });

  return { options, origin };
}

export async function completeRegistration({ user, response, challenge }) {
  const { rpID, origin } = getRpConfig();

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey registration could not be verified');
  }

  const info = verification.registrationInfo;
  const credentialId = info.credential.id;

  // Re-registering the same authenticator should replace, not duplicate.
  await WebAuthnCredential.deleteOne({ credentialId });

  const created = await WebAuthnCredential.create({
    userId: String(user._id),
    credentialId,
    publicKey: info.credential.publicKey,
    counter: info.credential.counter,
    transports: response?.response?.transports || [],
    backedUp: !!info.credentialDeviceType?.includes('backedUp') || false,
    deviceType: info.credentialDeviceType || '',
    name: '',
  });

  return created;
}

// --- Authentication ---------------------------------------------------------

export async function buildAuthenticationOptions(challenge) {
  const { rpID } = getRpConfig();
  // No allowCredentials: this is a usable (discoverable) credential flow, so
  // the user is not asked to identify themselves first.
  const options = await generateAuthenticationOptions({
    rpID,
    // Same reasoning as registration: use the challenge we persisted.
    challenge,
    userVerification: 'preferred',
  });
  return options;
}

export async function completeAuthentication({ response, challenge }) {
  const { rpID, origin } = getRpConfig();

  const credentialId = response?.id;
  if (!credentialId) throw new Error('Missing credential id');

  const credential = await WebAuthnCredential.findOne({ credentialId }).lean();
  if (!credential) throw new Error('Passkey not recognised');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: credential.credentialId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports || [],
    },
  });

  if (!verification.verified) throw new Error('Passkey authentication failed');

  // Persist the counter. A cloned authenticator reveals itself here.
  await WebAuthnCredential.updateOne(
    { _id: credential._id },
    {
      $set: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    }
  );

  return { userId: String(credential.userId), credentialId };
}

// --- One-time login ticket --------------------------------------------------

/**
 * After a passkey is verified we still have to hand the user a NextAuth
 * session, and NextAuth only mints sessions through a provider's authorize().
 * So we issue a short-lived, single-use ticket that the dedicated `webauthn`
 * credentials provider exchanges for a session.
 *
 * The ticket is scoped to 60 seconds and deleted on redemption, so capturing
 * one is useful only within that window and only once.
 */
async function ticketCollection() {
  const db = mongoose.connection?.db;
  if (!db) throw new Error('Database not connected');
  const col = db.collection('webauthn_tickets');
  await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: TICKET_TTL_MS / 1000 }).catch(() => {});
  return col;
}

export async function issueLoginTicket(userId) {
  const ticket = crypto.randomBytes(32).toString('base64url');
  const col = await ticketCollection();
  await col.insertOne({ _id: ticket, userId: String(userId), createdAt: new Date() });
  return ticket;
}

/**
 * Exchange a ticket for a user id. Single-use — the document is deleted, so a
 * replay fails even inside the 60s window.
 */
export async function consumeLoginTicket(ticket) {
  if (!ticket || typeof ticket !== 'string' || ticket.length > 200) return null;
  const col = await ticketCollection();
  const doc = await col.findOneAndDelete({ _id: ticket });
  if (!doc) return null;
  if (Date.now() - new Date(doc.createdAt).getTime() > TICKET_TTL_MS) return null;
  return doc.userId;
}
