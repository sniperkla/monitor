import connectDB from '@/lib/mongodb';
import User from '@/models/User.js';

// In-memory TTL cache — the ONLY place supporter status is resolved for gating.
// Worst case one indexed User lookup per user per TTL window.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key → { value, at }

function computeFromDoc(doc) {
  if (!doc) return { isSupporter: false, expiresAt: null, isAdmin: false };
  if (doc.role === 'admin') return { isSupporter: true, expiresAt: null, isAdmin: true };
  const s = doc.supporter || {};
  const expiresAt = s.expiresAt ? new Date(s.expiresAt) : null;
  const active = !!s.status && (!expiresAt || expiresAt.getTime() > Date.now());
  return { isSupporter: active, expiresAt: expiresAt || null, isAdmin: false };
}

function cacheKey(email) {
  return `email:${String(email).trim().toLowerCase()}`;
}

/**
 * Resolve supporter status for an account email (admin bypass included).
 * Cached for 5 minutes. Call invalidateSupporter() after grant/revoke.
 */
export async function getSupporterStatus(email) {
  if (!email) return { isSupporter: false, expiresAt: null, isAdmin: false };
  const key = cacheKey(email);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const db = await connectDB(process.env.MONGODB_URI, true);
  // Google accounts may store mixed-case emails — exact match first, then lowercase.
  let doc = await User.findOne({ email: String(email) }).select('role supporter').lean();
  if (!doc) doc = await User.findOne({ email: String(email).trim().toLowerCase() }).select('role supporter').lean();

  const value = computeFromDoc(doc);
  cache.set(key, { value, at: Date.now() });
  return value;
}

/** Drop cached status (single email, or everything when omitted). */
export function invalidateSupporter(email) {
  if (email) cache.delete(cacheKey(email));
  else cache.clear();
}

/** Standard 403 body for gated endpoints. */
export function supporterRequiredResponse(feature = 'relay') {
  return Response.json(
    { error: 'SUPPORTER_REQUIRED', feature, message: 'This feature requires a supporter membership.' },
    { status: 403 }
  );
}

/** Extend a supporter period: stacks on the current unexpired remainder. */
export function extendExpiry(currentExpiresAt, days) {
  const base = currentExpiresAt && new Date(currentExpiresAt).getTime() > Date.now()
    ? new Date(currentExpiresAt).getTime()
    : Date.now();
  return new Date(base + days * 24 * 60 * 60 * 1000);
}

export const DEFAULT_GRANT_DAYS = 30;

/**
 * AI features gate — server-funded AI (Groq keys from settings/env) requires an
 * active supporter membership. Users who bring their own API key ("manual"
 * mode) are always allowed since they don't consume the server's quota.
 */
export async function canUseServerAi(email, usingOwnKey = false) {
  if (usingOwnKey) return true;
  const status = await getSupporterStatus(email);
  return status.isSupporter;
}

/** Standard 403 body for gated AI endpoints. */
export function aiSupporterRequiredResponse() {
  return Response.json(
    {
      error: 'SUPPORTER_REQUIRED',
      feature: 'ai',
      message: 'AI features require a supporter membership. Bring your own API key (Manual model) or become a supporter.',
    },
    { status: 403 }
  );
}
