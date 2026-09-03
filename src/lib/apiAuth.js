import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import ApiKey from '@/models/ApiKey';
import { getClientIp } from '@/lib/clientIp';

/**
 * API key issuance, verification, and scope enforcement.
 *
 * Threat model
 * ------------
 * A session cookie is a bearer token for everything the user can do. Handing
 * one to a script means that script's compromise is the account's compromise.
 * Scoped keys bound the damage: a backup-triggering key cannot delete
 * connections, and revoking it costs one database write rather than a global
 * sign-out.
 *
 * Admin scopes are intentionally absent from the catalogue. Administrative
 * actions stay session-only so that a leaked key cannot escalate to
 * system-wide access.
 */

export const SCOPES = {
  'connections:read': 'List and inspect connections',
  'connections:write': 'Create, update and delete connections',
  'connections:query': 'Run queries against a connection',
  'backups:read': 'List and download backups',
  'backups:write': 'Create, restore and upload backups',
  'skills:write': 'Install skills',
  'deploy:write': 'Trigger deployments',
};

export const ALL_SCOPES = Object.keys(SCOPES);

/** Keys are never valid forever by default. */
const DEFAULT_TTL_DAYS = 180;
const MAX_TTL_DAYS = 365;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey)).digest('hex');
}

/**
 * Mint a key. Returns the plaintext once; only the hash is persisted.
 *
 * @param {object} opts
 * @param {string[]} opts.scopes
 * @param {number} [opts.ttlDays]
 * @returns {{key: string, prefix: string, keyHash: string, expiresAt: Date|null}}
 */
export function generateApiKey({ scopes = [], ttlDays = DEFAULT_TTL_DAYS } = {}) {
  const random = base64url(crypto.randomBytes(32)); // 256 bits of entropy
  const key = `mk_${random}`;

  const days = Math.min(Math.max(Number(ttlDays) || DEFAULT_TTL_DAYS, 1), MAX_TTL_DAYS);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  return {
    key,
    prefix: key.slice(0, 11), // "mk_" + 8 chars — enough to identify, not to use
    keyHash: hashApiKey(key),
    expiresAt,
  };
}

/**
 * Resolve a raw API key to its owner.
 *
 * @param {string} rawKey
 * @returns {Promise<{userId: string, scopes: string[], keyId: string}|null>}
 */
export async function verifyApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string' || rawKey.length > 200) return null;

  await connectDB(process.env.MONGODB_URI, true);
  const record = await ApiKey.findOne({ keyHash: hashApiKey(rawKey) }).lean();
  if (!record) return null;

  if (record.revokedAt) return null;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return null;

  return {
    userId: String(record.userId),
    scopes: Array.isArray(record.scopes) ? record.scopes : [],
    keyId: String(record._id),
  };
}

function readApiKey(request) {
  const header =
    request?.headers?.get?.('x-api-key') ||
    null;
  if (header) return header.trim();

  // Bearer is accepted for compatibility with off-the-shelf HTTP clients that
  // cannot set custom headers. Same trust level.
  const auth = request?.headers?.get?.('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();

  return null;
}

/**
 * Authenticate a request by session OR API key, then enforce scopes.
 *
 * Session callers are unrestricted: a human at the keyboard is the user, and
 * the browser session has always had full rights. Only key-based callers are
 * scope-checked — that is the entire point of issuing them.
 *
 * @param {Request} request
 * @param {object} [opts]
 * @param {string[]} [opts.scopes] scopes required for a key-based caller
 * @returns {Promise<{ok: true, userId: string, email: string|null, via: string, scopes: string[]}
 *                 | {ok: false, response: Response}>}
 */
export async function requireApiAuth(request, { scopes = [] } = {}) {
  // 1. Session first — the common path, and no scope restriction applies.
  const session = await getServerSession(authOptions).catch(() => null);
  if (session?.user?.id) {
    return {
      ok: true,
      userId: String(session.user.id),
      email: session.user.email || null,
      via: 'session',
      scopes: ALL_SCOPES,
    };
  }

  // 2. API key.
  const rawKey = readApiKey(request);
  if (!rawKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  const identity = await verifyApiKey(rawKey).catch(() => null);
  if (!identity) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Invalid or revoked API key' },
        { status: 401 }
      ),
    };
  }

  const missing = (scopes || []).filter((s) => !identity.scopes.includes(s));
  if (missing.length) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: 'This API key is missing required scope(s)',
          required: scopes,
          missing,
        },
        { status: 403 }
      ),
    };
  }

  // Stamp last-used. Fire-and-forget: telemetry must not slow or fail a request.
  const lastUsedIpFrom = (r) => {
    const ip = getClientIp(r);
    return ip === 'unknown' ? null : ip;
  };
  ApiKey.updateOne(
    { _id: identity.keyId },
    {
      $set: {
        lastUsedAt: new Date(),
        // Resolved through the shared helper. A client-set XFF would let an
        // API-key caller falsify the "last used from" record.
        lastUsedIp: lastUsedIpFrom(request),
      },
    }
  ).catch(() => {});

  return {
    ok: true,
    userId: identity.userId,
    email: null,
    via: 'apikey',
    scopes: identity.scopes,
  };
}

export { DEFAULT_TTL_DAYS, MAX_TTL_DAYS };
