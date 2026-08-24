import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decryptWithMetadata, encryptWithPassword } from '@/utils/encryption';
import { logger } from '@/lib/logger';

/**
 * GET /api/connections/export?mode=encrypted|plain&password=...
 *
 * mode=encrypted (default): credentials stay encrypted in the export.
 * mode=plain: credentials are decrypted to plain text (⚠️ dangerous).
 * password: if provided, re-encrypt credentials using this password.
 */
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`connections_export:${clientIP}`, 50);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'encrypted';
    const password = searchParams.get('password') || null;

    const db = await connectDB();
    const repo = new ConnectionRepository(db, session?.user?.id || session?.user?.sub || null);
    await repo.init();
    const connections = await repo.findAll();

    // Safe decrypt helper — only returns plain text when decryption actually succeeded.
    // decryptWithMetadata never throws; on failure it returns { text: originalEncryptedBlob, success: false }.
    // Without the success check, we'd export the encrypted blob and corrupt credentials on import.
    const safeDecrypt = (value) => {
      if (!value) return null;
      const result = decryptWithMetadata(value);
      if (!result.success) {
        logger.warn('⚠️ Export: could not decrypt a credential field — it will be null in the export.');
        return null;
      }
      return result.text;
    };

    const exported = connections.map(conn => {
      const raw = conn.toObject ? conn.toObject() : conn;
      
      const data = {
        name: raw.name,
        type: raw.type || 'ssh',
        dbProvider: raw.dbProvider || 'mongodb',
        host: raw.host,
        port: raw.port,
        username: raw.username,
        database: raw.database,
        authType: raw.authType,
        keyFileName: raw.keyFileName,
        tags: raw.tags,
        color: raw.color,
        notes: raw.notes || '',
        sshTunnel: !!raw.sshTunnel,
        sshTunnelHost: raw.sshTunnelHost || null,
        sshTunnelPort: raw.sshTunnelPort || 22,
        sshTunnelUser: raw.sshTunnelUser || null,
        sshTunnelAuth: raw.sshTunnelAuth || 'password',
      };

      const fields = [
        'password', 'privateKey', 'passphrase',
        'sshTunnelPassword', 'sshTunnelPrivateKey', 'sshTunnelPassphrase'
      ];

      if (mode === 'plain') {
        fields.forEach(f => { data[f] = safeDecrypt(raw[f]); });
      } else if (password) {
        // Mode is encrypted AND password is provided -> Re-encrypt with password
        fields.forEach(f => {
          const plain = safeDecrypt(raw[f]);
          data[f] = encryptWithPassword(plain, password);
        });
      } else {
        // If they chose 'encrypted' but didn't provide a password, 
        // we can't export safely because the server key is about to be removed.
        // For safety, clear these fields or skip.
        fields.forEach(f => { data[f] = null; });
      }

      return data;
    });

    return NextResponse.json({
      success: true,
      data: exported,
      encrypted: mode !== 'plain',
      password_protected: !!password,
      _verify: password ? encryptWithPassword('__ok__', password) : null,
    });
  } catch (error) {
    logger.error('Export Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
