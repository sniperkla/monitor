import connectDB, { getCenterUri } from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { basename } from '@/utils/pii';

/**
 * Shared store for the Server Backup history list.
 *
 * Two problems are solved here:
 *
 * 1. Ownership. The SystemSetting schema requires `userId` and enforces a
 *    unique (userId, key) index, but the old route queried by `key` alone.
 *    `findOne({ key })` returns the first matching row belonging to ANY user,
 *    and `findOneAndUpdate({ key }, ..., { upsert: true })` would overwrite it
 *    — so every signed-in user could read and clobber everyone else's
 *    backup history. All access now goes through the (userId, key) pair.
 *
 * 2. Path disclosure. Stored entries carry the remote server's absolute
 *    filepath (`/tmp/backup_<uuid>.tar.gz`) and a presigned CDN URL. Those are
 *    operationally necessary, but they must never leave the server: they leak
 *    the target host's filesystem layout, the connection id, and the CDN
 *    bucket structure. `toPublicEntry()` emits an opaque `fileRef` instead,
 *    which `resolveBackupPath()` maps back to the real path — and only within
 *    the calling user's own history.
 */

export const HISTORY_KEY = 'server_backup_history';
export const MAX_ENTRIES = 100;

const MAX_ID = 64;
const MAX_PATH = 1024;
const MAX_URL = 2048;
const MAX_TYPE = 64;
const MAX_TIMESTAMP = 40;

function boundedString(value, max) {
  if (typeof value !== 'string') return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Whitelist + clamp one history entry before it is persisted.
 *
 * The client posts the whole array, so nothing here can be trusted: an entry
 * could otherwise smuggle arbitrary nested data (or a multi-megabyte string)
 * into a shared settings collection.
 */
export function sanitizeStoredEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const connectionId = boundedString(raw.connectionId, MAX_ID);
  if (!connectionId) return null;

  const size = Number(raw.size);

  return {
    id: raw.id === undefined || raw.id === null ? null : boundedString(String(raw.id), MAX_ID),
    timestamp: boundedString(raw.timestamp, MAX_TIMESTAMP),
    type: boundedString(raw.type, MAX_TYPE),
    connectionId,
    filePath: boundedString(raw.filePath, MAX_PATH),
    logFilePath: boundedString(raw.logFilePath, MAX_PATH),
    size: Number.isFinite(size) ? size : null,
    r2Url: boundedString(raw.r2Url, MAX_URL),
  };
}

/**
 * The only shape of a history entry that is allowed to reach the browser.
 * Note the absence of `filePath`, `logFilePath` and `r2Url`.
 */
export function toPublicEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const hasRemoteFile = typeof entry.filePath === 'string' && entry.filePath.length > 0;
  const hasCloudCopy = typeof entry.r2Url === 'string' && entry.r2Url.length > 0;
  const size = Number(entry.size);

  return {
    id: entry.id ?? null,
    // Opaque handle the download route resolves server-side.
    fileRef: hasRemoteFile && entry.id != null ? String(entry.id) : null,
    filename: basename(entry.filePath),
    hasCloudCopy,
    timestamp: entry.timestamp ?? null,
    type: entry.type ?? null,
    connectionId: entry.connectionId ?? null,
    size: Number.isFinite(size) ? size : null,
  };
}

/** Raw (server-side) history for one user. Never return this to a client. */
export async function loadBackupHistory(userId) {
  await connectDB(getCenterUri(), true);
  const setting = await SystemSetting.findOne({ userId, key: HISTORY_KEY }).lean();
  return Array.isArray(setting?.value) ? setting.value : [];
}

/**
 * Persist a sanitized history list for one user.
 *
 * The browser only ever holds the public projection of an entry, so a
 * load -> save round-trip would otherwise wipe `filePath`, `logFilePath` and
 * `r2Url` (they are absent from what the client posts back). Those three are
 * carried forward by id from whatever is already stored. Deletions still work:
 * an entry the client drops is simply absent from the new list.
 */
export async function saveBackupHistory(userId, entries) {
  await connectDB(getCenterUri(), true);

  const existing = await loadBackupHistory(userId);
  const previousById = new Map();
  for (const entry of existing) {
    if (entry && entry.id != null) previousById.set(String(entry.id), entry);
  }

  const merged = entries.map((entry) => {
    const prev = entry.id != null ? previousById.get(String(entry.id)) : null;
    if (!prev) return entry;
    return {
      ...entry,
      filePath: entry.filePath || prev.filePath || null,
      logFilePath: entry.logFilePath || prev.logFilePath || null,
      r2Url: entry.r2Url || prev.r2Url || null,
    };
  });

  await SystemSetting.findOneAndUpdate(
    { userId, key: HISTORY_KEY },
    { $set: { value: merged } },
    { upsert: true, new: true }
  );

  return merged;
}

/**
 * Look up the raw (server-side) entry behind an opaque `fileRef`.
 * Scoped to `userId`'s own history, so a guessed or stolen ref from another
 * account resolves to nothing.
 */
export async function resolveBackupEntry(userId, { connectionId, fileRef }) {
  if (!userId || !connectionId || !fileRef) return null;
  const history = await loadBackupHistory(userId);
  const match = history.find(
    (entry) =>
      entry &&
      String(entry.id) === String(fileRef) &&
      String(entry.connectionId) === String(connectionId)
  );
  return match || null;
}

/** Map an opaque `fileRef` back to the real remote path. */
export async function resolveBackupPath(userId, { connectionId, fileRef }) {
  const entry = await resolveBackupEntry(userId, { connectionId, fileRef });
  return entry?.filePath || null;
}

/** Map an opaque `fileRef` back to the presigned CDN URL, if there is one. */
export async function resolveBackupCloudUrl(userId, { connectionId, fileRef }) {
  const entry = await resolveBackupEntry(userId, { connectionId, fileRef });
  return entry?.r2Url || null;
}
