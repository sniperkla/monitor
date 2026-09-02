import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import ApiKey from '@/models/ApiKey';
import {
  generateApiKey,
  SCOPES,
  ALL_SCOPES,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
} from '@/lib/apiAuth';
import { auditLog } from '@/lib/auditLog';

/**
 * API key management. Session-only by design: minting a key requires an
 * interactive login. Allowing key creation with a key would let a compromised
 * script issue itself a longer-lived, wider-scoped successor.
 */

const MAX_NAME_LEN = 64;
const MAX_KEYS_PER_USER = 20;

/** GET /api/user/api-keys — list this user's keys (never the secret). */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const keys = await ApiKey.find({ userId: String(session.user.id) })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({
      success: true,
      data: keys.map((k) => ({
        id: String(k._id),
        name: k.name || '',
        prefix: k.prefix,
        scopes: k.scopes || [],
        createdAt: k.createdAt,
        expiresAt: k.expiresAt || null,
        revokedAt: k.revokedAt || null,
        lastUsedAt: k.lastUsedAt || null,
        active: !k.revokedAt && (!k.expiresAt || new Date(k.expiresAt).getTime() > Date.now()),
      })),
      meta: { availableScopes: SCOPES, maxKeys: MAX_KEYS_PER_USER },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/user/api-keys — mint a new key.
 *
 * Body: { name?, scopes: string[], ttlDays? }
 * The plaintext key is returned exactly once and is never recoverable.
 */
export async function POST(request) {
  let body = null;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    body = await request.json().catch(() => ({}));
    const name = String(body?.name || '').slice(0, MAX_NAME_LEN);

    const requested = Array.isArray(body?.scopes) ? body.scopes : [];
    const invalid = requested.filter((s) => !ALL_SCOPES.includes(s));
    if (invalid.length) {
      return NextResponse.json(
        { success: false, error: `Unknown scope(s): ${invalid.join(', ')}` },
        { status: 400 }
      );
    }
    if (requested.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Select at least one scope' },
        { status: 400 }
      );
    }

    await connectDB(process.env.MONGODB_URI, true);

    const activeCount = await ApiKey.countDocuments({
      userId: String(session.user.id),
      revokedAt: null,
    });
    if (activeCount >= MAX_KEYS_PER_USER) {
      return NextResponse.json(
        {
          success: false,
          error: `You have ${activeCount} active keys. Revoke one before creating another.`,
        },
        { status: 409 }
      );
    }

    const ttlDays = Math.min(Math.max(Number(body?.ttlDays) || DEFAULT_TTL_DAYS, 1), MAX_TTL_DAYS);
    const { key, prefix, keyHash, expiresAt } = generateApiKey({ scopes: requested, ttlDays });

    const created = await ApiKey.create({
      userId: String(session.user.id),
      name,
      prefix,
      keyHash,
      scopes: requested,
      expiresAt,
    });

    await auditLog({
      req: request,
      action: 'apikey.create',
      userId: String(session.user.id),
      userEmail: session.user.email,
      detail: { keyId: String(created._id), scopes: requested, ttlDays },
      status: 'success',
    });

    return NextResponse.json({
      success: true,
      data: {
        id: String(created._id),
        // SHOWN ONCE. Only the hash is stored, so this value cannot be
        // recovered later — if it is lost, revoke the key and mint a new one.
        key,
        prefix,
        scopes: requested,
        expiresAt,
      },
      warning: 'Copy this key now — it will not be shown again.',
    });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'apikey.create',
      userId: null,
      detail: { error: error?.message?.slice(0, 200) },
      status: 'failure',
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
