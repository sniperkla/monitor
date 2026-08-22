import crypto from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
import { finished } from 'node:stream/promises';
import { isIP } from 'node:net';
import { MAX_BLOCKLIST_BYTES, MAX_BLOCKLIST_ENTRIES, getConflictingEntries, normalizeEntry, parseBlocklistLine } from '@/lib/firewallBlocklist';

const ID_RE = /^[0-9a-f-]{36}$/i;
const EXPIRES_MS = 30 * 60 * 1000;

function importPath(id) {
  if (!ID_RE.test(id || '')) throw new Error('Invalid import reference. Upload the file again.');
  return join(tmpdir(), `monitor-firewall-import-${id}.txt`);
}

function batches() {
  global.__firewallBulkBatches ||= new Map();
  const now = Date.now();
  for (const [id, batch] of global.__firewallBulkBatches) {
    if (batch.expiresAt < now) {
      global.__firewallBulkBatches.delete(id);
      unlink(batch.filePath).catch(() => {});
    }
  }
  return global.__firewallBulkBatches;
}

function imports() {
  global.__firewallBulkImports ||= new Map();
  const now = Date.now();
  for (const [id, record] of global.__firewallBulkImports) {
    if (record.expiresAt < now) {
      global.__firewallBulkImports.delete(id);
      unlink(record.filePath).catch(() => {});
    }
  }
  return global.__firewallBulkImports;
}

export async function stageBlocklistUpload(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('A blocklist file is required.');
  if (file.size > MAX_BLOCKLIST_BYTES) throw new Error('Each blocklist file must be 128 MB or smaller.');

  const id = crypto.randomUUID();
  const rawPath = join(tmpdir(), `monitor-firewall-raw-${id}`);
  const outputPath = importPath(id);
  let accepted = 0;
  let ignored = 0;
  try {
    await writeFile(rawPath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    const output = createWriteStream(outputPath, { mode: 0o600 });
    const lines = readline.createInterface({ input: createReadStream(rawPath), crlfDelay: Infinity });
    for await (const line of lines) {
      const entry = parseBlocklistLine(line);
      if (entry && isIP(entry.split('/')[0]) === 4) {
        accepted += 1;
        if (accepted > MAX_BLOCKLIST_ENTRIES) throw new Error(`One file exceeds the ${MAX_BLOCKLIST_ENTRIES.toLocaleString()} entry safety limit.`);
        if (!output.write(`${entry}\n`)) await new Promise(resolve => output.once('drain', resolve));
      } else if (String(line).trim() && !String(line).trim().startsWith('#')) {
        ignored += 1;
      }
    }
    output.end();
    await finished(output);
    imports().set(id, { filePath: outputPath, expiresAt: Date.now() + EXPIRES_MS });
    return { id, accepted, ignored };
  } catch (error) {
    await unlink(outputPath).catch(() => {});
    throw error;
  } finally {
    await unlink(rawPath).catch(() => {});
  }
}

export async function prepareBulkBatch(importIds, protectedIps = []) {
  if (!Array.isArray(importIds) || !importIds.length) throw new Error('Upload at least one supported blocklist file.');
  const sources = [...new Set(importIds)].map(id => imports().get(id)?.filePath);
  if (sources.some(filePath => !filePath || !existsSync(filePath))) throw new Error('An uploaded file expired. Upload it again before applying.');
  const batchId = crypto.randomUUID();
  const filePath = join(tmpdir(), `monitor-firewall-batch-${batchId}.txt`);
  const output = createWriteStream(filePath, { mode: 0o600 });
  let entryCount = 0;
  for (const source of sources) {
    const lines = readline.createInterface({ input: createReadStream(source), crlfDelay: Infinity });
    for await (const entry of lines) {
      if (!entry) continue;
      entryCount += 1;
      if (entryCount > MAX_BLOCKLIST_ENTRIES) throw new Error(`The combined files exceed the ${MAX_BLOCKLIST_ENTRIES.toLocaleString()} entry safety limit.`);
      if (!output.write(`${entry}\n`)) await new Promise(resolve => output.once('drain', resolve));
    }
  }
  output.end();
  await finished(output);

  const allProtection = [...new Set(protectedIps.map(normalizeEntry).filter(Boolean).map(ip => ip.split('/')[0]))];
  const conflicts = [];
  const lines = readline.createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const entry of lines) {
    const match = getConflictingEntries([entry], allProtection)[0];
    if (match) conflicts.push(match);
    if (conflicts.length >= 1000) break;
  }
  batches().set(batchId, { filePath, entryCount, conflicts, protectedIps: allProtection, expiresAt: Date.now() + EXPIRES_MS });
  return { batchId, entryCount, conflicts, protectedIps: allProtection };
}

export function getBulkBatch(batchId) {
  const batch = batches().get(batchId);
  if (!batch) throw new Error('This import expired. Upload the files again before applying.');
  return batch;
}

export async function discardBulkBatch(batchId) {
  const batch = batches().get(batchId);
  if (!batch) return;
  batches().delete(batchId);
  await unlink(batch.filePath).catch(() => {});
}
