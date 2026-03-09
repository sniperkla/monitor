import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';

import { encrypt, decryptWithPassword, decryptWithMetadata } from '@/utils/encryption';
import crypto from 'crypto';

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
 * 3. Else try to decrypt with THIS server's current key (prevents double-encryption).
 * 4. Finally encrypt with this server's current key.
 */
function reEncrypt(value, password, oldKey, fieldName) {
  if (!value) return null;

  // If it's not and doesn't look like an encrypted string (no colons), treat as plain text
  if (typeof value === 'string' && !value.includes(':')) {
    console.log(`[reEncrypt] ${fieldName} - plain text detected`);
    return encrypt(value);
  }

  if (password) {
    const plain = decryptWithPassword(value, password);
    if (plain !== null) {
      console.log(`[reEncrypt] ${fieldName} - Success using password`);
      return encrypt(plain);
    } else {
      console.log(`[reEncrypt] ${fieldName} - FAILED using password! value: ${value.substring(0, 15)}...`);
    }
  }

  if (oldKey) {
    const plain = decryptWithCustomKey(value, oldKey);
    if (plain !== null) {
      console.log(`[reEncrypt] ${fieldName} - Success using oldKey`);
      return encrypt(plain);
    } else {
      console.log(`[reEncrypt] ${fieldName} - FAILED using oldKey!`);
    }
  }

  // Fallback: try to decrypt with current key (maybe it's a same-server import)
  const meta = decryptWithMetadata(value);
  if (meta.success && meta.text !== value) {
     console.log(`[reEncrypt] ${fieldName} - Success using current key fallback`);
     return encrypt(meta.text); 
  }

  console.log(`[reEncrypt] ${fieldName} - All decryption failed! Defaulting to double-encrypting`);
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
    console.log(`📥 Import requested. Body keys: ${Object.keys(body).join(', ')}`);

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
      console.warn(`⚠️ Import blocked: ${items.length} items exceeds limit.`);
      return NextResponse.json({ 
        success: false, 
        error: `Import limit exceeded. Maximum ${MAX_IMPORT_LIMIT} connections allowed per file.` 
      }, { status: 400 });
    }

    console.log(`📦 Processing ${items.length} items for import...`);
    let imported = 0;
    let updated = 0;
    for (const item of items) {
      if (!item.name || !item.host) {
        console.warn('⏭️ Skipping item without name or host:', item.name || 'unnamed');
        continue;
      }


      const connectionData = {
        name: item.name,
        type: item.type || 'ssh',
        dbProvider: item.dbProvider || 'mongodb',
        host: item.host,
        port: item.port || 22,
        username: item.username || 'root',
        database: item.database || null,
        authType: item.authType || 'password',
        password: reEncrypt(item.password, password, oldKey, 'password'),
        privateKey: reEncrypt(item.privateKey, password, oldKey, 'privateKey'),
        keyFileName: item.keyFileName || null,
        passphrase: reEncrypt(item.passphrase, password, oldKey, 'passphrase'),
        tags: item.tags || [],
        color: item.color || '#6366f1',
        notes: item.notes || '',
        // SSH Tunnel
        sshTunnel: !!item.sshTunnel,
        sshTunnelHost: item.sshTunnelHost || null,
        sshTunnelPort: item.sshTunnelPort || 22,
        sshTunnelUser: item.sshTunnelUser || null,
        sshTunnelAuth: item.sshTunnelAuth || 'password',
        sshTunnelPassword: reEncrypt(item.sshTunnelPassword, password, oldKey, 'sshTunnelPassword'),
        sshTunnelPrivateKey: reEncrypt(item.sshTunnelPrivateKey, password, oldKey, 'sshTunnelPrivateKey'),
        sshTunnelPassphrase: reEncrypt(item.sshTunnelPassphrase, password, oldKey, 'sshTunnelPassphrase'),
      };

      // Check if connection already exists to prevent duplicates
      const existing = await repo.findOne({ 
        name: item.name, 
        host: item.host,
        type: item.type || 'ssh'
      });

      if (existing) {
        console.log(`🔄 Updating existing connection: ${item.name} (${existing._id})`);
        await repo.update(existing._id, connectionData);
        updated++;
      } else {
        console.log(`✨ Creating new connection: ${item.name}`);
        await repo.create(connectionData);
        imported++;
      }
    }

    console.log(`🏁 Import finished: ${imported} imported, ${updated} updated.`);
    return NextResponse.json({ success: true, count: imported, updated });


  } catch (error) {
    console.error('Import Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
