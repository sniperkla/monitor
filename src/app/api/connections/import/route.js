import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { encrypt } from '@/utils/encryption';
import crypto from 'crypto';

const IV_LENGTH = 16;

/**
 * Decrypt an encrypted blob using an arbitrary hex key.
 * Returns the plain text, or null if decryption fails.
 */
function decryptWithCustomKey(encryptedText, hexKey) {
  if (!encryptedText || !hexKey) return null;
  if (!encryptedText.includes(':')) return encryptedText; // not encrypted, return as-is
  try {
    const key = crypto.createHash('sha256').update(String(hexKey)).digest();
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const ciphertext = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch {
    return null;
  }
}

/**
 * Re-encrypt a field: decrypt with the old key, then encrypt with the
 * current server's ENCRYPTION_KEY.  If no oldKey is provided or the
 * value isn't encrypted, encrypt it directly as plain text.
 */
function reEncrypt(value, oldKey) {
  if (!value) return null;

  if (oldKey) {
    // Value is encrypted with the old server's key → decrypt first
    const plain = decryptWithCustomKey(value, oldKey);
    if (plain === null) {
      // Decryption failed — store as-is (might be plain text already)
      return encrypt(value);
    }
    return encrypt(plain);
  }

  // No old key provided — treat value as plain text and encrypt
  return encrypt(value);
}

/**
 * POST /api/connections/import
 *
 * Body can be:
 *   • An array of connections (backward compatible — plain-text credentials)
 *   • { connections: [...], oldEncryptionKey: "hex" }   ← new secure mode
 *
 * When `oldEncryptionKey` is supplied the endpoint will:
 *   1. Decrypt each credential field using the OLD key
 *   2. Re-encrypt it with this server's current ENCRYPTION_KEY
 *
 * This lets admins migrate between servers safely without ever exposing
 * plain-text passwords in the export file.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`connections_import:${clientIP}`, 50);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const db = await connectDB();
    const repo = new ConnectionRepository(db);
    await repo.init();

    const body = await request.json();

    // Support both formats:
    //   1. Array directly (old format, plain-text credentials)
    //   2. { connections: [...], oldEncryptionKey: "..." }
    let items, oldKey;
    if (Array.isArray(body)) {
      items = body;
      oldKey = null;
    } else if (body.connections && Array.isArray(body.connections)) {
      items = body.connections;
      oldKey = body.oldEncryptionKey || null;
    } else {
      return NextResponse.json({ success: false, error: 'Expected an array of connections or { connections, oldEncryptionKey }' }, { status: 400 });
    }

    const MAX_IMPORT_LIMIT = 100;
    if (items.length > MAX_IMPORT_LIMIT) {
      return NextResponse.json({ 
        success: false, 
        error: `Import limit exceeded. Maximum ${MAX_IMPORT_LIMIT} connections allowed per file.` 
      }, { status: 400 });
    }

    let imported = 0;
    for (const item of items) {
      if (!item.name || !item.host) continue;

      await repo.create({
        name: item.name,
        type: item.type || 'ssh',
        dbProvider: item.dbProvider || 'mongodb',
        host: item.host,
        port: item.port || 22,
        username: item.username || 'root',
        database: item.database || null,
        authType: item.authType || 'password',
        password: reEncrypt(item.password, oldKey),
        privateKey: reEncrypt(item.privateKey, oldKey),
        keyFileName: item.keyFileName || null,
        passphrase: reEncrypt(item.passphrase, oldKey),
        tags: item.tags || [],
        color: item.color || '#6366f1',
        notes: item.notes || '',
        // SSH Tunnel
        sshTunnel: !!item.sshTunnel,
        sshTunnelHost: item.sshTunnelHost || null,
        sshTunnelPort: item.sshTunnelPort || 22,
        sshTunnelUser: item.sshTunnelUser || null,
        sshTunnelAuth: item.sshTunnelAuth || 'password',
        sshTunnelPassword: reEncrypt(item.sshTunnelPassword, oldKey),
        sshTunnelPrivateKey: reEncrypt(item.sshTunnelPrivateKey, oldKey),
        sshTunnelPassphrase: reEncrypt(item.sshTunnelPassphrase, oldKey),
      });
      imported++;
    }

    return NextResponse.json({ success: true, count: imported });
  } catch (error) {
    console.error('Import Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
