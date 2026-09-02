import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, sftpReadStream } from '../_ssh';
import { uploadStreamToR2, isR2Configured } from '@/lib/r2';
import { basename } from '@/utils/pii';
import { logger } from '@/lib/logger';
import {
  createWrappedDek,
  createEncryptTransform,
  encryptionMetadata,
  backupEncryptionAvailable,
} from '@/lib/backupCrypto';
import { auditLog } from '@/lib/auditLog';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (!isR2Configured()) {
      return NextResponse.json({ success: false, error: 'R2 storage not configured. Set R2 environment variables.' }, { status: 500 });
    }

    const body = await request.json();
    const { connectionId, filePath, filename } = body;

    if (!connectionId || !filePath) {
      return NextResponse.json({ success: false, error: 'Missing connectionId or filePath' }, { status: 400 });
    }

    const name = filename || filePath.split('/').pop() || 'backup.tar.gz';
    const userId = session.user?.id || session.user?.sub || 'unknown';
    const key = `backups/${connectionId}/${name}`;

    logger.info(`[upload-r2] Starting upload: ${key}`);

    const sshConfig = await getSshConfig(connectionId);
    const stream = await sftpReadStream(sshConfig, filePath);

    // Envelope encryption: the bucket only ever holds ciphertext. R2's own
    // at-rest encryption still applies on top (it is on by default), so the
    // object is encrypted twice — once for the provider trust boundary, once
    // for the disk.
    //
    // The wrapped DEK travels in the object's metadata, which makes each
    // backup self-describing: /api/server-backup/download-r2 can decrypt with
    // nothing but the bucket and the master key.
    let encrypted = false;
    let uploadBody = stream;
    let metadata = null;
    let contentType = 'application/gzip';

    if (backupEncryptionAvailable()) {
      const { dek, wrappedDek } = createWrappedDek(userId);
      metadata = encryptionMetadata({ userId, wrappedDek });
      uploadBody = stream.pipe(createEncryptTransform(dek));
      contentType = 'application/octet-stream';
      encrypted = true;
      // The DEK is only held for the duration of the upload; the closure above
      // is the only reference and it goes out of scope when this handler ends.
    } else {
      logger.warn('[upload-r2] backup encryption unavailable — uploading plaintext');
    }

    await uploadStreamToR2(key, uploadBody, contentType, metadata);

    logger.info(`[upload-r2] Upload complete: ${key} (encrypted=${encrypted})`);

    await auditLog({
      req: request,
      action: 'backup.upload_r2',
      userId,
      userEmail: session.user?.email,
      detail: { connectionId, encrypted, filename: basename(name) },
      status: 'success',
    });

    // Do not return a direct public/presigned URL. A URL is a bearer
    // capability: anyone who sees it can download the backup until it expires,
    // and R2_PUBLIC_DOMAIN would make the capability permanent. Downloads now
    // go through /api/server-backup/download-r2 where the session and the
    // per-tenant key unwrap are checked first.
    return NextResponse.json({
      success: true,
      filename: basename(name) || 'backup.tar.gz',
      cloudStored: true,
      encrypted,
    });
  } catch (error) {
    logger.error('[upload-r2] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
