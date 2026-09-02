import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import ApiKey from '@/models/ApiKey';
import { auditLog } from '@/lib/auditLog';

/**
 * DELETE /api/user/api-keys/:id — revoke a key.
 *
 * Revocation is a soft delete (revokedAt is stamped rather than the row being
 * removed) so that audit history stays interpretable: an entry referencing a
 * key id still resolves to something after the key is gone.
 *
 * Scoped to the owner: the filter includes userId, so a guessed id belonging to
 * another account matches nothing. Revoking invalidates only this key — the
 * user's session and their other keys are untouched, which is the whole point
 * of having keys instead of sharing a session.
 */
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: 'Invalid key id' }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);

    const result = await ApiKey.updateOne(
      { _id: id, userId: String(session.user.id), revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Key not found or already revoked' },
        { status: 404 }
      );
    }

    await auditLog({
      req: request,
      action: 'apikey.revoke',
      userId: String(session.user.id),
      userEmail: session.user.email,
      detail: { keyId: id },
      status: 'success',
    });

    return NextResponse.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
