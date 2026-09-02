import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { decrypt } from '@/utils/encryption';
import { rateLimit, getClientIp } from '@/lib/ratelimit';
import { auditLog } from '@/lib/auditLog';

/**
 * POST /api/utils/decrypt — reveal stored connection secrets.
 *
 * SECURITY: this route is a decryption oracle and is treated as one.
 *
 * Any authenticated caller can hand this endpoint an arbitrary ciphertext and
 * get back the plaintext, decrypted with the app-wide ENCRYPTION_KEY. On its
 * own that is not a breach — the caller must already possess the ciphertext.
 * What it does is amplify: any bug that leaks one encrypted field (an IDOR, a
 * log line, a shared-connection feature) escalates from "opaque blob" to
 * "live SSH private key". So the blast radius is constrained here rather than
 * at the source.
 *
 * Controls applied:
 *  - Strict field allowlist. Only the three fields the UI actually reveals can
 *    be submitted; the handler never iterates over caller-supplied keys, so a
 *    new sensitive field cannot be silently added to the surface.
 *  - Input shape + size validation. Values must look like `iv:hex` and be
 *    bounded, which rejects junk before it reaches the cipher.
 *  - Tight per-user rate limit. Revealing a password is a rare, deliberate
 *    click, not a polling operation — 10/min is generous.
 *  - Audited, with the field names but never the values.
 *
 * RESIDUAL RISK: connections stored in the browser (localStorage / manual)
 * were encrypted by /api/utils/encrypt with this same app-wide key, so the
 * client legitimately holds ciphertext the server cannot attribute to a
 * record. Those cannot be ownership-checked here. Closing that gap properly
 * means moving browser-stored secrets to a client-held key (as the vault
 * already does) — a storage migration, not a route fix.
 */

const ALLOWED_FIELDS = ['password', 'privateKey', 'passphrase'];
const MAX_FIELD_CHARS = 64 * 1024; // private keys are the large one
const CIPHERTEXT_RE = /^[0-9a-f]{32}:[0-9a-f]+$/i;

export async function POST(request) {
  let body = null;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Per-user, not per-IP: sharing a NAT with a colleague must not let their
    // reveal attempts exhaust my budget.
    const limit = await rateLimit(`decrypt:u:${session.user.id}`, { limit: 10, window: '1 m' });
    if (!limit.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many reveal requests. Try again in ${Math.max(1, Math.ceil(limit.reset / 1000))}s.`,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, Math.ceil(limit.reset / 1000))),
            'X-RateLimit-Remaining': String(limit.remaining),
          },
        }
      );
    }

    body = await request.json();
    const data = body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 });
    }

    const decrypted = {};
    const revealedFields = [];

    for (const field of ALLOWED_FIELDS) {
      const value = data[field];
      if (value === undefined || value === null || value === '') continue;

      if (typeof value !== 'string' || value.length > MAX_FIELD_CHARS) {
        return NextResponse.json(
          { success: false, error: `Invalid value for ${field}` },
          { status: 400 }
        );
      }
      // Reject anything that is not our own iv:hex envelope. This also blocks
      // a caller from tricking the handler into echoing back plaintext (the
      // legacy decrypt() passes non-colon values through untouched).
      if (!CIPHERTEXT_RE.test(value)) {
        return NextResponse.json(
          { success: false, error: `Malformed ciphertext for ${field}` },
          { status: 400 }
        );
      }

      decrypted[field] = decrypt(value);
      revealedFields.push(field);
    }

    if (revealedFields.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No decryptable fields provided' },
        { status: 400 }
      );
    }

    // Field names only — never the values, and never the ciphertext.
    await auditLog({
      req: request,
      action: 'secret.reveal',
      userId: session.user.id,
      userEmail: session.user.email,
      detail: { fields: revealedFields, ip: getClientIp(request) },
      status: 'success',
    });

    return NextResponse.json({ success: true, data: decrypted });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'secret.reveal',
      userId: null,
      detail: { error: error?.message?.slice(0, 200), ip: getClientIp(request) },
      status: 'failure',
    }).catch(() => {});

    // Do not echo the underlying message: it can distinguish "bad ciphertext"
    // from "bad key", which is useful signal when probing an oracle.
    return NextResponse.json({ success: false, error: 'Decryption failed' }, { status: 500 });
  }
}
