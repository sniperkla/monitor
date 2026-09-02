/**
 * Server-side admin authorization.
 *
 * The session callback (src/lib/auth.js) deliberately does NOT include
 * `role` in the session object — it was removed to prevent /api/auth/session
 * from being a reconnaissance endpoint (any XSS could read the victim's role).
 *
 * This means admin routes CANNOT trust `session.user.role` (it is always
 * undefined). They must re-check the database directly. This helper does that
 * in one place so every admin route uses the same logic.
 *
 * Usage:
 *   import { requireAdmin } from '@/lib/requireAdmin';
 *   const { session, user, error } = await requireAdmin(req);
 *   if (error) return error;
 *
 * Pass the request so denials can be audited with an IP and user-agent. Every
 * admin route funnels through here, which makes it the only place that can see
 * all of them — a rejected admin call is exactly the signal you want stored,
 * and it cannot be wired per-route without duplicating this five times.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { auditLog } from '@/lib/auditLog';

/**
 * Verify that the current request is from an authenticated admin.
 *
 * Checks (in order):
 * 1. Valid NextAuth session exists (user is logged in)
 * 2. The user's DB record has role === 'admin'.
 *
 * ADMIN_EMAIL is used only when provisioning/updating the first admin account;
 * it is not an authorization bypass. A matching email without the persisted
 * admin role must never grant access to admin routes.
 *
 * @param {Request} [req] Optional Next.js request, used for the audit trail.
 * @returns {{ session, user, error?: NextResponse }}
 *   On success: { session, user } where user is the Mongoose document.
 *   On failure: { error } — a NextResponse to return immediately.
 */
export async function requireAdmin(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    await auditLog({
      req,
      action: 'admin.access_denied',
      userId: null,
      detail: { reason: 'unauthenticated' },
      status: 'failure',
    });
    return {
      error: NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  // Re-check role from the database — never trust the session object.
  await connectDB(process.env.MONGODB_URI, true);
  const user = await User.findById(session.user.id).lean();

  const isAdminByRole = user?.role === 'admin';

  if (!isAdminByRole) {
    // An authenticated non-admin reaching for an admin route is either a bug or
    // a privilege-escalation attempt. Either way it belongs in the trail.
    await auditLog({
      req,
      action: 'admin.access_denied',
      userId: String(session.user.id),
      userEmail: session.user?.email,
      detail: { reason: 'not_admin', role: user?.role || null },
      status: 'failure',
    });
    return {
      error: NextResponse.json(
        { success: false, error: 'Forbidden: Admin access required' },
        { status: 403 }
      ),
    };
  }

  return { session, user };
}
