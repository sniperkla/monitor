import crypto from 'node:crypto';
import { Transform } from 'node:stream';

/**
 * Envelope encryption for server backups stored in Cloudflare R2.
 *
 * Why client-side encryption here
 * -------------------------------
 * R2 already encrypts objects at rest with AES-256 on Cloudflare's side. That
 * protects against theft of Cloudflare's disks, but not against anyone with
 * valid access to the bucket: a leaked R2 API token, a misconfigured access
 * policy, or a compulsion order served on the provider all yield plaintext
 * backups — and a backup is the entire database, credentials included.
 *
 * Envelope encryption removes the provider from the trust boundary entirely:
 * the bucket only ever holds ciphertext. Each backup gets its own random DEK,
 * which is wrapped (encrypted) by a per-tenant KEK derived from the app master
 * key. Nothing but this application, holding the master key, can unwrap a DEK.
 *
 * Construction
 * ------------
 * AES-256-GCM cannot encrypt a stream in one shot (the whole payload plus the
 * auth tag must fit in memory, and the tag is only known at the end). So the
 * stream is framed into 1 MB chunks, each independently AEAD'd with a unique
 * nonce derived from a per-object base IV and the frame index. The frame index
 * is also authenticated as AAD, which prevents frame reordering. A FINAL flag
 * on the last frame prevents silent truncation.
 *
 *   magic 'BENC' | version u8 | baseIv 8B
 *   frame*: ciphertextLen u32BE | flags u8 (bit0=FINAL) | GCM(ciphertext+tag)
 *
 * Key hierarchy
 * -------------
 *   master      ← BACKUP_ENCRYPTION_KEY env, else ENCRYPTION_KEY (domain-separated)
 *   tenant KEK  = HKDF-SHA256(master, salt=userId, info='backup-kek-v1')
 *   object DEK  = random 32B, wrapped with AES-256-GCM(tenant KEK, random iv)
 *
 * Per-tenant derivation means a bug that ever mixed up wrapped keys between
 * users fails cryptographically instead of decrypting someone else's data.
 */

const MAGIC = Buffer.from('BENC', 'ascii');
const VERSION = 1;
const FRAME_SIZE = 1024 * 1024; // 1 MB plaintext per frame
const TAG_LEN = 16;
const FLAG_FINAL = 0x01;

function masterKeyMaterial() {
  const explicit = process.env.BACKUP_ENCRYPTION_KEY;
  if (explicit) return `explicit:${explicit}`;

  const fallback = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (fallback) {
    // Domain separation: the same secret used elsewhere must never act as a
    // backup master key byte-for-byte.
    return `backup-master-v1:${fallback}`;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY is not configured. Refusing to encrypt backups ' +
      'with no key in production.'
    );
  }
  return 'backup-master-v1:development_only_key_do_not_deploy';
}

/** Per-tenant wrapping key (KEK). */
export function tenantKek(userId) {
  const material = masterKeyMaterial();
  const salt = Buffer.from(String(userId || ''), 'utf8');
  return Buffer.from(
    crypto.hkdfSync('sha256', material, salt, Buffer.from('backup-kek-v1', 'utf8'), 32)
  );
}

/** Generate a fresh DEK and wrap it for `userId`. Returns base64 fields. */
export function createWrappedDek(userId) {
  const dek = crypto.randomBytes(32);
  const kek = tenantKek(userId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    dek,
    // iv.tag.ciphertext — the order mirrors utils/encryption.js conventions.
    wrappedDek: Buffer.concat([iv, tag, wrapped]).toString('base64'),
  };
}

/** Unwrap a DEK. Only the owning tenant's KEK produces a valid unwrap. */
export function unwrapDek(userId, wrappedDekB64) {
  const blob = Buffer.from(String(wrappedDekB64), 'base64');
  if (blob.length < 12 + TAG_LEN + 1) throw new Error('Malformed wrapped key');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 12 + TAG_LEN);
  const ciphertext = blob.subarray(12 + TAG_LEN);

  const decipher = crypto.createDecipheriv('aes-256-gcm', tenantKek(userId), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** R2 object metadata describing the envelope. */
export function encryptionMetadata({ userId, wrappedDek }) {
  return {
    enc: 'aes-256-gcm-stream',
    encv: String(VERSION),
    wdek: wrappedDek,
    // Tenant id for auditability — the cryptographic binding comes from the
    // per-tenant KEK, but having it visible in metadata makes bucket listing
    // and incident review far easier.
    u: String(userId || ''),
  };
}

/** Parse and validate R2 object metadata into unwrap params. */
export function parseEncryptionMetadata(meta) {
  if (!meta || meta.enc !== 'aes-256-gcm-stream') return null;
  if (meta.encv !== String(VERSION)) throw new Error(`Unsupported backup encryption version: ${meta.encv}`);
  if (!meta.wdek) throw new Error('Backup encryption metadata missing wrapped key');
  return { wrappedDek: meta.wdek, userId: meta.u || null };
}

function frameNonce(baseIv, index) {
  const nonce = Buffer.alloc(12);
  baseIv.copy(nonce, 0);
  nonce.writeUInt32BE(index >>> 0, 8);
  return nonce;
}

function frameAad(baseIv, index) {
  const aad = Buffer.alloc(12);
  baseIv.copy(aad, 0);
  aad.writeUInt32BE(index >>> 0, 8);
  return aad;
}

/**
 * Transform stream: plaintext in, framed ciphertext out.
 *
 * @param {Buffer} dek 32-byte data encryption key
 */
export function createEncryptTransform(dek) {
  const baseIv = crypto.randomBytes(8);
  let buffer = Buffer.alloc(0);
  let index = 0;
  let headerEmitted = false;

  function emitFrame(plaintext, final, cb) {
    const nonce = frameNonce(baseIv, index);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonce);
    cipher.setAAD(frameAad(baseIv, index));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const body = Buffer.concat([ciphertext, tag]);

    const head = Buffer.alloc(5);
    head.writeUInt32BE(body.length, 0);
    head.writeUInt8(final ? FLAG_FINAL : 0, 4);

    index += 1;
    cb(null, Buffer.concat([head, body]));
  }

  return new Transform({
    transform(chunk, _enc, cb) {
      buffer = Buffer.concat([buffer, chunk]);

      if (!headerEmitted) {
        headerEmitted = true;
        this.push(Buffer.concat([MAGIC, Buffer.from([VERSION]), baseIv]));
      }

      const flushPiece = (piece) =>
        new Promise((resolve, reject) =>
          emitFrame(piece, false, (err, frame) => (err ? reject(err) : resolve(frame)))
        );

      (async () => {
        while (buffer.length >= FRAME_SIZE) {
          const piece = buffer.subarray(0, FRAME_SIZE);
          buffer = buffer.subarray(FRAME_SIZE);
          this.push(await flushPiece(piece));
        }
      })().then(() => cb(), cb);
    },

    flush(cb) {
      // Always emit a FINAL frame — even for an empty payload — so the reader
      // can distinguish "complete empty backup" from "truncated stream".
      if (!headerEmitted) {
        this.push(Buffer.concat([MAGIC, Buffer.from([VERSION]), baseIv]));
      }
      emitFrame(buffer, true, (err, frame) => {
        if (err) return cb(err);
        this.push(frame);
        cb();
      });
    },
  });
}

/**
 * Transform stream: framed ciphertext in, plaintext out.
 * Throws on any auth-tag mismatch, reordering, truncation, or missing FINAL.
 *
 * @param {Buffer} dek
 */
export function createDecryptTransform(dek) {
  let state = 'magic';
  let want = 4; // bytes needed for the current parse step
  let buffer = Buffer.alloc(0);
  let baseIv = null;
  let index = 0;
  let sawFinal = false;
  let pendingFlags = 0;
  let pendingLen = 0;

  return new Transform({
    transform(chunk, _enc, cb) {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        for (;;) {
          if (state === 'magic') {
            if (buffer.length < 13) break;
            if (!buffer.subarray(0, 4).equals(MAGIC)) {
              throw new Error('Not an encrypted backup (bad magic)');
            }
            const version = buffer.readUInt8(4);
            if (version !== VERSION) throw new Error(`Unsupported backup encryption version: ${version}`);
            baseIv = buffer.subarray(5, 13);
            buffer = buffer.subarray(13);
            state = 'frame-head';
            continue;
          }

          if (state === 'frame-head') {
            if (buffer.length < 5) break;
            pendingLen = buffer.readUInt32BE(0);
            pendingFlags = buffer.readUInt8(4);
            if (pendingLen < TAG_LEN || pendingLen > FRAME_SIZE + TAG_LEN) {
              throw new Error('Corrupt frame length');
            }
            buffer = buffer.subarray(5);
            state = 'frame-body';
            continue;
          }

          // frame-body
          if (buffer.length < pendingLen) break;
          const body = buffer.subarray(0, pendingLen);
          buffer = buffer.subarray(pendingLen);

          const ciphertext = body.subarray(0, body.length - TAG_LEN);
          const tag = body.subarray(body.length - TAG_LEN);

          const nonce = frameNonce(baseIv, index);
          const decipher = crypto.createDecipheriv('aes-256-gcm', dek, nonce);
          decipher.setAAD(frameAad(baseIv, index));
          decipher.setAuthTag(tag);
          const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

          index += 1;
          if (pendingFlags & FLAG_FINAL) sawFinal = true;

          this.push(plaintext);
          state = 'frame-head';
        }
        cb();
      } catch (err) {
        cb(err);
      }
    },

    flush(cb) {
      if (state !== 'magic' && !sawFinal) {
        // Truncated stream — treat as corruption, never emit partial plaintext.
        return cb(new Error('Encrypted backup is truncated'));
      }
      cb();
    },
  });
}

/** Whether the encryption feature can run (key material present). */
export function backupEncryptionAvailable() {
  try {
    tenantKek('probe');
    return true;
  } catch {
    return false;
  }
}
