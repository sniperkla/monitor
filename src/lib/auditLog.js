import mongoose from 'mongoose';

/**
 * Audit logging for sensitive actions — the security trail.
 *
 * COLLECTION NAMING TRAP — read this before querying the database.
 * There are three write-only trails and their names differ by an underscore.
 * Mongoose pluralizes without snake-casing, so the models land in collections
 * that are NOT the one this module writes to:
 *
 *   audit_logs    <- this module             security incident trail (query this)
 *   auditlogs     <- models/AuditLog.js      per-server operational history
 *   activitylogs  <- models/ActivityLog.js   user-facing UI timeline
 *
 * `audit_logs` and `auditlogs` are different collections. Everything a security
 * review needs is mirrored into `audit_logs`, including privileged
 * server-monitor actions — which is why src/app/api/server-monitor/app-action
 * calls this in addition to its own typed model. The AuditLog write is kept for
 * its indexed connectionId/appName/version, which supports "what changed on
 * this host" queries that this flatter shape does not.
 *
 * What gets recorded
 * ------------------
 *   { userId, action, ip, ts, ua }  — the fields required by the spec, plus
 *   method / path / status / target for context during triage.
 *
 * Why it is worth the write
 * -------------------------
 * This is the only detective control in the stack. Rate limiting and CSRF
 * prevent; they do not tell you what happened at 03:00. When a user reports an
 * unexpected connection deletion, the answer is `db.audit_logs.find({
 * userId, action: /^connection\./ })` — not a log grep across three files.
 *
 * Remember `server.service.*` is here too: if you only grep the route handlers
 * for `auditLog` you will miss that server-monitor writes through a helper.
 *
 * Guarantees
 * ----------
 *  - Fire-and-forget: an audit failure is logged and swallowed. A monitoring
 *    write must never be able to break a user's request.
 *  - Bounded: `detail` is truncated so a hostile payload cannot turn the audit
 *    collection into a memory-exhaustion vector.
 *  - TTL: 90 days, matching the pre-existing retention.
 */

let ensured = false;

/** Reject anything larger than this rather than storing it. */
const MAX_DETAIL_BYTES = 8 * 1024;

async function getCollection() {
  if (!mongoose.connection?.db) return null;
  const col = mongoose.connection.db.collection('audit_logs');
  if (!ensured) {
    try {
      // TTL index: documents expire 90 days after creation.
      await col.createIndex({ ts: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
      await col.createIndex({ userId: 1, ts: -1 });
      await col.createIndex({ action: 1, ts: -1 });
      // Investigating "which accounts did this IP touch" — the query you want
      // after a credential-stuffing report.
      await col.createIndex({ ip: 1, ts: -1 });
      ensured = true;
    } catch {
      // Index creation races are harmless; collection still usable.
    }
  }
  return col;
}

/**
 * Best-effort client IP. Kept local (rather than importing
 * src/lib/ratelimit.js) so this module stays usable from any runtime.
 */
function clientIp(req) {
  const get = (k) => (typeof req?.headers?.get === 'function' ? req.headers.get(k) : req?.headers?.[k]);
  return (
    get('x-forwarded-for')?.split(',')[0]?.trim() ||
    get('x-real-ip') ||
    get('cf-connecting-ip') ||
    'unknown'
  );
}

function userAgent(req) {
  const get = (k) => (typeof req?.headers?.get === 'function' ? req.headers.get(k) : req?.headers?.[k]);
  return get('user-agent') || null;
}

/** Truncate a JSON-serialisable detail object so it cannot bloat the cluster. */
function sanitizeDetail(detail) {
  if (!detail || typeof detail !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = value;
      continue;
    }
    // Arrays/objects: keep a compact JSON snapshot, capped.
    try {
      out[key] = JSON.stringify(value).slice(0, 512);
    } catch {
      out[key] = '[unserialisable]';
    }
  }
  try {
    if (JSON.stringify(out).length > MAX_DETAIL_BYTES) return { _truncated: true };
  } catch {
    return { _truncated: true };
  }
  return out;
}

/**
 * Write an audit entry.
 *
 * @param {object} p
 * @param {Request} [p.req]        Next.js request (for IP / UA / method / path)
 * @param {string}  p.action       Dotted name, e.g. 'connection.delete',
 *                                 'admin.supporters.grant', 'vault.unlock'
 * @param {string}  [p.userId]     acting user id
 * @param {string}  [p.userEmail]  acting user email
 * @param {object}  [p.detail]     small JSON-serialisable context — NO secrets
 * @param {string}  [p.status]     'success' | 'failure'
 * @param {string}  [p.target]     what the action acted on (id, never a secret)
 */
export async function auditLog({ req, action, userId, userEmail, detail, status, target }) {
  try {
    const col = await getCollection();
    if (!col) return;

    const entry = {
      action,
      userId: userId || null,
      userEmail: userEmail || null,
      ip: clientIp(req),
      ua: userAgent(req),
      method: req?.method || null,
      path: req?.nextUrl?.pathname || (typeof req?.url === 'string' ? new URL(req.url).pathname : null),
      status: status || null,
      target: target || null,
      detail: sanitizeDetail(detail),
      ts: new Date(),
      // Legacy field: some pre-existing queries sort on createdAt.
      createdAt: new Date(),
    };

    await col.insertOne(entry);
  } catch (e) {
    // Never let audit failures break the request path.
    console.error('[audit] failed to write entry:', e?.message);
  }
}

/**
 * Convenience wrapper: audit + return the response, so call sites read as one
 * line instead of two.
 *
 *   return await audited(req, response, { action: 'skill.install', userId, detail });
 */
export async function audited(req, response, { action, userId, userEmail, detail, target }) {
  await auditLog({
    req,
    action,
    userId,
    userEmail,
    target,
    detail,
    status: response?.status >= 400 ? 'failure' : 'success',
  });
  return response;
}
