import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { logger } from '@/lib/logger';

/**
 * POST /api/user/cloud-migrate
 *
 * Accepts a batch of connections pre-encrypted on the client side with
 * the highest-sensitivity scheme:
 *   Argon2id (64 MB mem, 3 iters, parallelism=4) → 256-bit key → AES-256-GCM
 *
 * The server stores ONLY the opaque ciphertext — it never sees any plaintext
 * connection data, passwords, or private keys.
 *
 * Body: {
 *   connections: [{
 *     fingerprint: string,   // dedup hash
 *     name:        string,   // display only (not sensitive)
 *     host:        string,   // display only
 *     type:        string,   // 'ssh' | 'database'
 *     encryptedData: string, // AES-256-GCM ciphertext (hex)
 *     salt:        string,   // Argon2id salt (hex)
 *     iv:          string,   // GCM IV (hex)
 *     authTag:     string,   // GCM auth tag (hex) — optional, may be appended to encryptedData
 *   }],
 *   replace: boolean,  // if true, wipe previous cloud connections before saving
 * }
 *
 * Response: { success, saved, skipped, total }
 */
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { connections, replace = false } = body;

    if (!Array.isArray(connections) || connections.length === 0) {
      return NextResponse.json({ error: 'No connections provided' }, { status: 400 });
    }

    if (connections.length > 500) {
      return NextResponse.json({ error: 'Max 500 connections per cloud-migrate call' }, { status: 400 });
    }

    // Always connect to the CENTER DB (server DB) — not the user's private local DB
    await connectDB(process.env.MONGODB_URI, true);

    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Optionally replace all existing cloud connections
    if (replace) {
      user.syncedConnections = [];
    }
    if (!user.syncedConnections) {
      user.syncedConnections = [];
    }

    let saved = 0;
    let skipped = 0;

    for (const conn of connections) {
      // Validate required fields
      if (!conn.fingerprint || !conn.encryptedData || !conn.salt || !conn.iv) {
        skipped++;
        continue;
      }

      // Basic length sanity checks (prevent abuse)
      if (
        conn.encryptedData.length > 65536 ||  // 32 KB encoded
        conn.salt.length > 128 ||
        conn.iv.length > 64
      ) {
        skipped++;
        continue;
      }

      const existingIdx = user.syncedConnections.findIndex(
        (sc) => sc.fingerprint === conn.fingerprint
      );

      const record = {
        fingerprint: conn.fingerprint,
        name: (conn.name || '').substring(0, 100),
        host: (conn.host || '').substring(0, 253),
        type: ['ssh', 'database'].includes(conn.type) ? conn.type : 'ssh',
        encryptedData: conn.encryptedData,
        salt: conn.salt,
        iv: conn.iv,
        syncedAt: new Date(),
      };

      if (existingIdx >= 0) {
        user.syncedConnections[existingIdx] = record;
      } else {
        user.syncedConnections.push(record);
      }
      saved++;
    }

    user.markModified('syncedConnections');
    await user.save();

    logger.info(
      `☁️  [cloud-migrate] ${session.user.email}: saved=${saved} skipped=${skipped} total=${user.syncedConnections.length} replace=${replace}`
    );

    return NextResponse.json({
      success: true,
      saved,
      skipped,
      total: user.syncedConnections.length,
    });
  } catch (error) {
    logger.error('[cloud-migrate] Error:', error);
    return NextResponse.json({ error: 'Server error', detail: error.message }, { status: 500 });
  }
}

/**
 * GET /api/user/cloud-migrate
 * Returns the count of cloud-migrated connections (not the data).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email })
      .select('syncedConnections')
      .lean();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      total: (user.syncedConnections || []).length,
      lastSync: (user.syncedConnections || []).reduce((latest, c) => {
        const t = new Date(c.syncedAt).getTime();
        return t > latest ? t : latest;
      }, 0),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
