import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decryptWithMetadata } from '@/utils/encryption';

/**
 * GET /api/connections/export?mode=encrypted|plain
 *
 * mode=encrypted (default): credentials stay encrypted in the export.
 * mode=plain: credentials are decrypted to plain text (⚠️ dangerous).
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

    const db = await connectDB();
    const repo = new ConnectionRepository(db);
    await repo.init();
    const connections = await repo.findAll();

    // Safe decrypt helper
    const safeDecrypt = (value) => {
      if (!value) return null;
      try {
        return decryptWithMetadata(value).text;
      } catch (err) {
        console.warn('⚠️ Export: could not decrypt a field, skipping:', err.message);
        return null;
      }
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

      if (mode === 'plain') {
        // Decrypt credentials to plain text
        data.password = safeDecrypt(raw.password);
        data.privateKey = safeDecrypt(raw.privateKey);
        data.passphrase = safeDecrypt(raw.passphrase);
        data.sshTunnelPassword = safeDecrypt(raw.sshTunnelPassword);
        data.sshTunnelPrivateKey = safeDecrypt(raw.sshTunnelPrivateKey);
        data.sshTunnelPassphrase = safeDecrypt(raw.sshTunnelPassphrase);
      } else {
        // Keep encrypted blobs as-is
        data.password = raw.password || null;
        data.privateKey = raw.privateKey || null;
        data.passphrase = raw.passphrase || null;
        data.sshTunnelPassword = raw.sshTunnelPassword || null;
        data.sshTunnelPrivateKey = raw.sshTunnelPrivateKey || null;
        data.sshTunnelPassphrase = raw.sshTunnelPassphrase || null;
      }

      return data;
    });

    return NextResponse.json({
      success: true,
      data: exported,
      encrypted: mode !== 'plain',
    });
  } catch (error) {
    console.error('Export Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
