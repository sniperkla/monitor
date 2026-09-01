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
 *   const { session, user, error } = await requireAdmin();
 *   if (error) return error;
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

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
 * @returns {{ session, user, error?: NextResponse }}
 *   On success: { session, user } where user is the Mongoose document.
 *   On failure: { error } — a NextResponse to return immediately.
 */
export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
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
    return {
      error: NextResponse.json(
        { success: false, error: 'Forbidden: Admin access required' },
        { status: 403 }
      ),
    };
  }

  return { session, user };
}
