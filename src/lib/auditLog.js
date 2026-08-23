import mongoose from 'mongoose';

/**
 * Audit logging for sensitive actions.
 *
 * Writes to the `audit_logs` MongoDB collection (fire-and-forget: a logging
 * failure must never break the user's request). Entries are auto-expired by a
 * TTL index after 90 days.
 *
 * Usage:
 *   await auditLog({ req, action: 'deploy.trigger', detail: { projectId } });
 */

let ensured = false;

async function getCollection() {
  if (!mongoose.connection?.db) return null;
  const col = mongoose.connection.db.collection('audit_logs');
  if (!ensured) {
    try {
      // TTL index: documents expire 90 days after creation
      await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
      await col.createIndex({ userId: 1, createdAt: -1 });
      await col.createIndex({ action: 1, createdAt: -1 });
      ensured = true;
    } catch {
      // Index creation races are harmless; collection still usable.
    }
  }
  return col;
}

function clientIp(req) {
  return (
    req?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() ||
    req?.headers?.get?.('x-real-ip') ||
    'unknown'
  );
}

/**
 * Fire-and-forget audit entry.
 * @param {object} p
 * @param {Request} [p.req]      Next.js request (for IP)
 * @param {string} p.action      e.g. 'deploy.trigger', 'rclone.exec', 'firewall.apply'
 * @param {string} [p.userId]    acting user id
 * @param {string} [p.userEmail] acting user email
 * @param {object} [p.detail]    small JSON-serializable context (no secrets!)
 */
export async function auditLog({ req, action, userId, userEmail, detail }) {
  try {
    const col = await getCollection();
    if (!col) return;
    await col.insertOne({
      action,
      userId: userId || null,
      userEmail: userEmail || null,
      ip: clientIp(req),
      detail: detail || {},
      createdAt: new Date(),
    });
  } catch (e) {
    // Never let audit failures break the request path.
    console.error('[audit] failed to write entry:', e?.message);
  }
}
