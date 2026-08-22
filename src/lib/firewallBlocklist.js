import { isIP } from 'node:net';

export const MAX_BLOCKLIST_ENTRIES = 2000000;
export const MAX_BLOCKLIST_BYTES = 128 * 1024 * 1024;

export function normalizeEntry(value) {
  const entry = String(value || '').trim().replace(/[;,]$/, '');
  if (!entry) return null;

  const [address, rawPrefix] = entry.split('/');
  const family = isIP(address);
  if (!family || (entry.match(/\//g) || []).length > 1) return null;
  if (rawPrefix === undefined) return address;
  if (!/^\d{1,3}$/.test(rawPrefix)) return null;

  const prefix = Number(rawPrefix);
  if (prefix < 0 || prefix > (family === 4 ? 32 : 128)) return null;
  return `${address}/${prefix}`;
}

function extractCandidate(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) return null;

  // Plain lists, ipset save/restore, iptables source rules, and hosts files.
  const tokens = trimmed.replace(/#.*/, '').trim().split(/\s+/);
  if (tokens.length === 1) return tokens[0];
  if ((tokens[0] === 'add' && tokens.length >= 3) ||
      (tokens[0] === 'ipset' && tokens[1] === 'add' && tokens.length >= 4)) {
    return tokens[tokens[0] === 'add' ? 2 : 3];
  }
  const sourceIndex = tokens.findIndex(token => token === '-s' || token === '--source');
  if (sourceIndex >= 0) return tokens[sourceIndex + 1];
  // Hosts format: 203.0.113.4 example.invalid
  return tokens[0];
}

export function parseBlocklistLine(line) {
  return normalizeEntry(extractCandidate(String(line)));
}

export function parseBlocklist(raw) {
  const source = String(raw || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_BLOCKLIST_BYTES) {
    throw new Error('The import is larger than 8 MB. Split it into smaller files before importing.');
  }

  let values = source.split(/\r?\n/);
  if (source.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) values = parsed.map(item => String(item));
    } catch {
      // Fall back to line parsing so a malformed JSON file is simply reported as ignored lines.
    }
  }

  const seen = new Set();
  let ignored = 0;
  for (const line of values) {
    const normalized = parseBlocklistLine(line);
    if (normalized) seen.add(normalized);
    else if (String(line).trim() && !String(line).trim().startsWith('#')) ignored += 1;
    if (seen.size > MAX_BLOCKLIST_ENTRIES) {
      throw new Error(`The import contains more than ${MAX_BLOCKLIST_ENTRIES.toLocaleString()} unique entries.`);
    }
  }

  return { entries: [...seen], ignored };
}

function ipToBigInt(address) {
  const family = isIP(address);
  if (family === 4) {
    return address.split('.').reduce((result, part) => (result << 8n) + BigInt(Number(part)), 0n);
  }

  const [left, right = ''] = address.toLowerCase().split('::');
  const leftParts = left ? left.split(':').filter(Boolean) : [];
  const rightParts = right ? right.split(':').filter(Boolean) : [];
  const missing = 8 - leftParts.length - rightParts.length;
  const parts = [...leftParts, ...Array(Math.max(0, missing)).fill('0'), ...rightParts];
  return parts.reduce((result, part) => (result << 16n) + BigInt(`0x${part || '0'}`), 0n);
}

export function entryCoversIp(entry, ip) {
  const normalizedEntry = normalizeEntry(entry);
  const normalizedIp = normalizeEntry(ip)?.split('/')[0];
  if (!normalizedEntry || !normalizedIp) return false;
  const [address, rawPrefix] = normalizedEntry.split('/');
  if (isIP(address) !== isIP(normalizedIp)) return false;
  if (rawPrefix === undefined) return address === normalizedIp;

  const bits = isIP(address) === 4 ? 32 : 128;
  const prefix = Number(rawPrefix);
  const shift = BigInt(bits - prefix);
  return (ipToBigInt(address) >> shift) === (ipToBigInt(normalizedIp) >> shift);
}

export function getConflictingEntries(entries, protectedIps) {
  const normalizedProtected = [...new Set((protectedIps || []).map(normalizeEntry).filter(Boolean))]
    .map(entry => entry.split('/')[0]);
  const conflicts = [];
  for (const entry of entries || []) {
    for (const protectedIp of normalizedProtected) {
      if (entryCoversIp(entry, protectedIp)) {
        conflicts.push({ entry, protectedIp });
        break;
      }
    }
  }
  return conflicts;
}

export function remoteClientIps(headers) {
  // Cloudflare supplies the original visitor address; otherwise the bundled
  // Nginx proxy overwrites X-Real-IP with its immediate client address. Both
  // are safer than X-Forwarded-For, which clients can append to.
  const directClient = headers.get('cf-connecting-ip') || headers.get('x-real-ip') || '';
  const forwarded = directClient || headers.get('x-forwarded-for') || '';
  return forwarded.split(',').map(value => normalizeEntry(value)?.split('/')[0]).filter(Boolean)
    .filter(ip => ip !== '127.0.0.1' && ip !== '::1');
}
