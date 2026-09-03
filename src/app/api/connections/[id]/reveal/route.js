import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decrypt } from '@/utils/encryption';
import { auditLog } from '@/lib/auditLog';
import { rateLimit } from '@/lib/ratelimit';
import mongoose from 'mongoose';

const isValidMongoId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * POST /api/connections/[id]/reveal
 *
 * Dedicated, authenticated, CSRF-protected, and rate-limited endpoint for
 * revealing stored secrets of an owned connection.
 *
 * Secrets are decrypted on demand and sent ONLY via POST to the verified owner.
 */
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const limit = await rateLimit(`reveal:u:${session.user.id}`, { limit: 10, window: '1 m' });
    if (!limit.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many reveal requests. Try again in ${Math.max(1, Math.ceil(limit.reset / 1000))}s.`,
        },
        { status: 429 }
      );
    }

    const { id } = await params;
    const db = await connectDB();
    const repo = new ConnectionRepository(db, session.user.id);

    if (db.type !== 'mysql' && db.type !== 'postgres' && !isValidMongoId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const connection = await repo.findById(id);
    if (!connection) {
      await auditLog({
        req: request,
        action: 'connection.reveal',
        userId: String(session.user.id),
        userEmail: session.user.email,
        detail: { reason: 'not_found' },
        target: String(id),
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    // Decrypt on demand for the owner only
    const revealed = {
      password: connection.password ? decrypt(connection.password) : null,
      privateKey: connection.privateKey ? decrypt(connection.privateKey) : null,
      passphrase: connection.passphrase ? decrypt(connection.passphrase) : null,
      sshTunnelPassword: connection.sshTunnelPassword ? decrypt(connection.sshTunnelPassword) : null,
      sshTunnelPrivateKey: connection.sshTunnelPrivateKey ? decrypt(connection.sshTunnelPrivateKey) : null,
      sshTunnelPassphrase: connection.sshTunnelPassphrase ? decrypt(connection.sshTunnelPassphrase) : null,
    };

    await auditLog({
      req: request,
      action: 'connection.reveal',
      userId: String(session.user.id),
      userEmail: session.user.email,
      detail: {
        revealedFields: Object.keys(revealed).filter((k) => !!revealed[k]),
      },
      target: String(id),
      status: 'success',
    });

    return NextResponse.json({ success: true, data: revealed });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
