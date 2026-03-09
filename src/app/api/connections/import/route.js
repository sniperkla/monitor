import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { encrypt, decryptWithPassword } from '@/utils/encryption';
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
 * Re-encrypt a field: 
 * 1. If password provided, decrypt with that first.
 * 2. Else if oldKey provided, decrypt with that.
 * 3. Then encrypt with this server's current key.
 */
function reEncrypt(value, password, oldKey) {
  if (!value) return null;

  if (password) {
    const plain = decryptWithPassword(value, password);
    if (plain !== null) return encrypt(plain);
  }

  if (oldKey) {
    const plain = decryptWithCustomKey(value, oldKey);
    if (plain !== null) return encrypt(plain);
  }

  // No password/key worked or provided — treat as plain text if it looks like it
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

    let items, oldKey, password;
    if (Array.isArray(body)) {
      items = body;
    } else if (body.connections && Array.isArray(body.connections)) {
      items = body.connections;
      oldKey = body.oldEncryptionKey || null;
      password = body.password || null;
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
        password: reEncrypt(item.password, password, oldKey),
        privateKey: reEncrypt(item.privateKey, password, oldKey),
        keyFileName: item.keyFileName || null,
        passphrase: reEncrypt(item.passphrase, password, oldKey),
        tags: item.tags || [],
        color: item.color || '#6366f1',
        notes: item.notes || '',
        // SSH Tunnel
        sshTunnel: !!item.sshTunnel,
        sshTunnelHost: item.sshTunnelHost || null,
        sshTunnelPort: item.sshTunnelPort || 22,
        sshTunnelUser: item.sshTunnelUser || null,
        sshTunnelAuth: item.sshTunnelAuth || 'password',
        sshTunnelPassword: reEncrypt(item.sshTunnelPassword, password, oldKey),
        sshTunnelPrivateKey: reEncrypt(item.sshTunnelPrivateKey, password, oldKey),
        sshTunnelPassphrase: reEncrypt(item.sshTunnelPassphrase, password, oldKey),
      });
      imported++;
    }

    return NextResponse.json({ success: true, count: imported });
  } catch (error) {
    console.error('Import Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
