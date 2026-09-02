import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { downloadStreamFromR2, isR2Configured } from '@/lib/r2';
import { parseEncryptionMetadata, unwrapDek, createDecryptTransform } from '@/lib/backupCrypto';
import { auditLog } from '@/lib/auditLog';
import { logger } from '@/lib/logger';

/**
 * GET /api/server-backup/download-r2?key=backups/<connectionId>/<name>
 *
 * Download a cloud-stored backup. Ownership is enforced two ways:
 *
 *  1. Tenant check. The connectionId embedded in the key must resolve to a
 *     connection owned by the caller (via the user-scoped repository). This is
 *     the gate for plaintext legacy objects.
 *  2. Cryptographic tenant binding. Envelope-encrypted objects can only be
 *     unwrapped with the KEK derived from the owning tenant's id, so a
 *     cross-user unwrap fails at the crypto layer even if everything above it
 *     were somehow bypassed.
 */

function safeFilename(value) {
  const fallback = 'backup.tar.gz';
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\r\n"\\]/g, '').trim();
  return cleaned ? cleaned.slice(0, 200) : fallback;
}

// Strictly the shape upload-r2 writes. Rejects traversal outright.
const KEY_RE = /^backups\/([a-zA-Z0-9_-]{1,64})\/([a-zA-Z0-9._-]{1,200})$/;

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!isR2Configured()) {
      return NextResponse.json({ success: false, error: 'R2 storage not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key') || '';
    const match = KEY_RE.exec(key);
    if (!match) {
      return NextResponse.json({ success: false, error: 'Invalid object key' }, { status: 400 });
    }
    const [, connectionId, name] = match;

    const userId = String(session.user.id);

    // 1. Ownership: user-scoped repository returns null for other tenants.
    const db = await connectDB();
    const repo = new ConnectionRepository(db, userId);
    const conn = await repo.findById(connectionId);
    if (!conn) {
      return NextResponse.json({ success: false, error: 'Backup not found' }, { status: 404 });
    }

    const { stream, metadata } = await downloadStreamFromR2(key);

    // 2. Decrypt if the object is envelope-encrypted.
    let bodyStream = stream;
    let contentType = 'application/gzip';
    const enc = parseEncryptionMetadata(metadata);
    if (enc) {
      if (enc.userId && enc.userId !== userId) {
        return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
      }
      let dek;
      try {
        dek = unwrapDek(userId, enc.wrappedDek);
      } catch {
        // Wrong tenant or corrupt wrapped key. The message stays generic so
        // this cannot be used to probe for other users' objects.
        return NextResponse.json({ success: false, error: 'Cannot decrypt backup' }, { status: 403 });
      }
      bodyStream = stream.pipe(createDecryptTransform(dek));
    } else {
      logger.warn(`[download-r2] plaintext object served: ${key}`);
    }

    await auditLog({
      req: request,
      action: 'backup.download_r2',
      userId,
      userEmail: session.user?.email,
      detail: { connectionId, encrypted: !!enc, filename: safeFilename(name) },
      status: 'success',
    });

    return new NextResponse(bodyStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeFilename(name)}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    logger.error('[server-backup/download-r2] error:', error.message);
    return NextResponse.json({ success: false, error: 'Download failed' }, { status: 500 });
  }
}
