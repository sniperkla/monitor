/**
 * SSRF protection for outbound database connection testing.
 *
 * The test-uri endpoint accepts a raw database URI from the user and would
 * otherwise open a TCP connection to any host the URI points at. That makes it
 * an SSRF vector — an attacker can probe internal services (169.254.169.254,
 * 127.0.0.1, 10.x, etc.) and use the 10s timeout as a timing oracle.
 *
 * This module resolves the hostname in the URI, checks every resolved IP
 * against a blocklist of private/reserved ranges, and rejects the connection
 * before any socket is opened.
 *
 * On DNS rebinding: this module can only ever be a PRE-connection defence.
 * There is no post-connect IP verification — by the time the driver has a
 * socket we cannot see which address it used, and we cannot stop it from
 * using a different one on a retry. A determined attacker who controls a DNS
 * record can still win the race between our resolution and the driver's
 * connect(). What we do instead:
 *
 *   1. Resolve, check, then RESOLVE AGAIN and re-check. A rebinder has to
 *      return a clean answer twice in a row and only then flip, which turns
 *      an easy race into a narrow one and defeats simple rotating records.
 *   2. Resolve `mongodb+srv://` SRV targets too, so the indirection through
 *      `_mongodb._tcp.<host>` cannot launder an internal address.
 *   3. Canonicalise non-canonical numeric hosts (0177.0.0.1, 2130706433,
 *      0x7f.1) the same way the OS resolver will, so the string we check is
 *      the address that will actually be dialled.
 *
 * Closing the residual TOCTOU window properly requires pinning the resolved IP
 * at the socket layer (a custom `lookup` passed to the driver), which the
 * MongoDB/MySQL/pg drivers here do not uniformly support. Until then, treat
 * this as strong-but-not-absolute.
 */

import dns from 'node:dns/promises';
import { logger } from './logger.js';

/**
 * IPv4 private/reserved CIDR ranges.
 * Each entry is [subnet, maskBits].
 */
const BLOCKED_IPV4_RANGES = [
  [0x00000000, 8],     // 0.0.0.0/8        — "this network"
  [0x0A000000, 8],     // 10.0.0.0/8       — private (RFC 1918)
  [0x7F000000, 8],     // 127.0.0.0/8      — loopback
  [0xA9FE0000, 16],    // 169.254.0.0/16   — link-local
  [0xAC100000, 12],    // 172.16.0.0/12    — private (RFC 1918)
  [0xC0A80000, 16],    // 192.168.0.0/16   — private (RFC 1918)
  [0xC6120000, 12],    // 198.18.0.0/15    — benchmarking (RFC 2544)
  [0xC6330000, 16],    // 198.51.100.0/24  — documentation (RFC 5737)
  [0xCB007100, 16],    // 203.0.113.0/24   — documentation (RFC 5737)
  [0x64400000, 10],    // 100.64.0.0/10    — CGNAT (RFC 6598)
  [0xE0000000, 4],     // 224.0.0.0/4      — multicast
  [0xF0000000, 4],     // 240.0.0.0/4      — reserved
];

/**
 * IPv6 private/reserved ranges (as prefix + bit length).
 * We compare the first N bits of the address.
 */
const BLOCKED_IPV6_PREFIXES = [
  ['::', 0],            // ::/0 is NOT blocked — we use specific prefixes below
  // Actually, let's be precise:
];

// More precise IPv6 blocklist:
const BLOCKED_IPV6 = [
  // ::/128 — unspecified address (connects to loopback on unix)
  { bytes: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prefixLen: 128 },
  // ::1/128 — loopback
  { bytes: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], prefixLen: 128 },
  // fe80::/10 — link-local
  { bytes: [0xfe,0x80,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prefixLen: 10 },
  // fc00::/7 — unique-local
  { bytes: [0xfc,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prefixLen: 7 },
  // ff00::/8 — multicast
  { bytes: [0xff,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prefixLen: 8 },
  // 2001:db8::/32 — documentation (RFC 3849)
  { bytes: [0x20,0x01,0x0d,0xb8,0,0,0,0,0,0,0,0,0,0,0,0], prefixLen: 32 },
  // 100::/64 — discard-only prefix (RFC 6666)
  { bytes: [0x01,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prefixLen: 64 },
  // ::ffff:0:0/96 — IPv4-mapped (delegate to IPv4 check)
];

/**
 * Convert a dotted-quad IPv4 string to a 32-bit unsigned integer.
 */
function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  // Convert to unsigned
  return result >>> 0;
}

/**
 * Check if an IPv4 address falls within any blocked range.
 */
function isBlockedIPv4(ip) {
  const addr = ipv4ToInt(ip);
  if (addr === null) return true; // if we can't parse it, block it

  for (const [subnet, maskBits] of BLOCKED_IPV4_RANGES) {
    const mask = maskBits === 0 ? 0 : (0xFFFFFFFF << (32 - maskBits)) >>> 0;
    if ((addr & mask) >>> 0 === (subnet & mask) >>> 0) {
      return true;
    }
  }
  return false;
}

/**
 * Convert an IPv6 address string (possibly with :: shorthand) to a 16-byte array.
 * Returns null if the address is malformed.
 */
function ipv6ToBytes(ip) {
  // Handle IPv4-mapped addresses like ::ffff:1.2.3.4
  const v4MappedMatch = ip.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch) {
    const v4 = v4MappedMatch[1];
    if (isBlockedIPv4(v4)) return null; // will be caught by caller as blocked
    // Expand as ::ffff:v4
    const v4Parts = v4.split('.').map(Number);
    const bytes = new Array(16).fill(0);
    bytes[10] = 0xff;
    bytes[11] = 0xff;
    bytes[12] = v4Parts[0];
    bytes[13] = v4Parts[1];
    bytes[14] = v4Parts[2];
    bytes[15] = v4Parts[3];
    return bytes;
  }

  // Handle :: shorthand
  let [head, tail] = ip.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];

  // Each part is a 16-bit hex value, contributing 2 bytes
  const headBytes = [];
  for (const part of headParts) {
    const val = parseInt(part, 16);
    if (isNaN(val) || val < 0 || val > 0xFFFF) return null;
    headBytes.push((val >> 8) & 0xFF, val & 0xFF);
  }

  const tailBytes = [];
  for (const part of tailParts) {
    const val = parseInt(part, 16);
    if (isNaN(val) || val < 0 || val > 0xFFFF) return null;
    tailBytes.push((val >> 8) & 0xFF, val & 0xFF);
  }

  const totalBytes = headBytes.length + tailBytes.length;
  if (ip.includes('::')) {
    // Fill the gap with zeros
    const zeros = new Array(16 - totalBytes).fill(0);
    return [...headBytes, ...zeros, ...tailBytes];
  } else {
    // No :: — must be exactly 8 parts
    if (headParts.length !== 8) return null;
    return headBytes;
  }
}

/**
 * Check if an IPv6 address falls within any blocked range.
 */
function isBlockedIPv6(ip) {
  const bytes = ipv6ToBytes(ip);
  if (bytes === null) return true; // unparseable = block

  for (const range of BLOCKED_IPV6) {
    let match = true;
    let remaining = range.prefixLen;
    let byteIdx = 0;
    while (remaining >= 8 && match) {
      if (bytes[byteIdx] !== range.bytes[byteIdx]) {
        match = false;
      }
      byteIdx++;
      remaining -= 8;
    }
    // Check partial byte
    if (match && remaining > 0) {
      const mask = (0xFF << (8 - remaining)) & 0xFF;
      if ((bytes[byteIdx] & mask) !== (range.bytes[byteIdx] & mask)) {
        match = false;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Check if an IP address (v4 or v6) is private/reserved/blocked.
 */
function isBlockedIP(ip) {
  if (ip.includes(':')) {
    return isBlockedIPv6(ip);
  }
  return isBlockedIPv4(ip);
}

/**
 * Parse one component of a numeric IPv4 address the way inet_aton() does.
 *
 * Accepts decimal (`127`), octal (`0177`), and hex (`0x7f`). Returns null if
 * the component is not purely numeric in one of those bases.
 */
function parseNumericPart(part) {
  if (!/^(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)$/.test(part)) return null;
  let value;
  if (/^0[xX]/.test(part)) value = parseInt(part.slice(2), 16);
  else if (part.length > 1 && part[0] === '0') value = parseInt(part.slice(1), 8);
  else value = parseInt(part, 10);
  return Number.isNaN(value) ? null : value;
}

/**
 * Canonicalise a non-canonical IPv4 address to dotted-quad, reproducing the
 * inet_aton() semantics the OS resolver uses.
 *
 * This matters because the resolver, not our blocklist, has the final say on
 * what gets dialled. `0177.0.0.1` is a perfectly ordinary *looking* string that
 * no dotted-quad blocklist matches, but inet_aton reads the leading zero as
 * octal and connects to 127.0.0.1. Similarly `2130706433` and `0x7f.1`.
 *
 * inet_aton accepts 1–4 components, with the last one absorbing the remaining
 * bytes:
 *   a         -> a is 32 bits
 *   a.b       -> a is 8 bits,  b is 24 bits
 *   a.b.c     -> a,b are 8 bits, c is 16 bits
 *   a.b.c.d   -> each is 8 bits
 *
 * @returns {string|null} dotted-quad, or null if this is not a numeric address
 */
export function canonicalizeNumericHost(hostname) {
  if (!hostname) return null;
  // Anything outside digits/dots/hex markers cannot be a numeric address.
  if (!/^[0-9a-fA-FxX.]+$/.test(hostname)) return null;
  // A bare hex word such as "deadbeef" is a legitimate hostname and inet_aton
  // would not read it as hex without the 0x prefix — don't touch it.
  if (!/^\d|^\./.test(hostname)) {
    // Allows "0x..." forms through to the split below; rejects "abcdef".
    if (!/^0[xX]/.test(hostname)) return null;
  }

  const parts = hostname.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  if (parts.some((p) => p === '')) return null;

  const values = [];
  for (const p of parts) {
    const v = parseNumericPart(p);
    if (v === null) return null;
    values.push(v);
  }

  let addr;
  if (parts.length === 1) {
    if (values[0] > 0xFFFFFFFF) return null;
    addr = values[0];
  } else if (parts.length === 2) {
    if (values[0] > 0xFF || values[1] > 0xFFFFFF) return null;
    addr = (values[0] << 24) | values[1];
  } else if (parts.length === 3) {
    if (values[0] > 0xFF || values[1] > 0xFF || values[2] > 0xFFFF) return null;
    addr = (values[0] << 24) | (values[1] << 16) | values[2];
  } else {
    if (values.some((v) => v > 0xFF)) return null;
    addr = (values[0] << 24) | (values[1] << 16) | (values[2] << 8) | values[3];
  }

  addr = addr >>> 0;
  return [
    (addr >>> 24) & 0xFF,
    (addr >>> 16) & 0xFF,
    (addr >>> 8) & 0xFF,
    addr & 0xFF,
  ].join('.');
}

/**
 * Safely URL-decode a hostname string to eliminate %2e, %30, and other
 * percent-encoded bypasses before canonicalization and IP blocklist validation.
 *
 * Runs iteratively up to 3 times to neutralize multi-layer encoding (e.g. %252e).
 */
export function safeDecodeHost(host) {
  let decoded = String(host ?? '').trim();
  for (let i = 0; i < 3; i++) {
    if (!decoded.includes('%')) break;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch (_) {
      break;
    }
  }
  return decoded;
}

/**
 * Resolve the SRV targets behind a `mongodb+srv://` host.
 *
 * `mongodb+srv://cluster.example.com` contains no address at all — the driver
 * looks up `_mongodb._tcp.cluster.example.com` and connects to whatever that
 * record names. Checking `cluster.example.com` in isolation therefore proves
 * nothing: a public SRV host can point at 127.0.0.1, and the blocklist never
 * sees it.
 *
 * @returns {string[]} target hostnames (may be empty if there is no SRV record)
 */
async function resolveMongoSrvTargets(hostname) {
  try {
    const records = await dns.resolveSrv(`_mongodb._tcp.${hostname}`);
    return (records || []).map((r) => r.name).filter(Boolean);
  } catch {
    // No SRV record, or DNS failure. The driver's own connect will surface
    // this; there is nothing extra for us to validate.
    return [];
  }
}

/**
 * Extract the hostname from a database URI string.
 * Handles mongodb://, mongodb+srv://, mysql://, postgres://, postgresql://
 *
 * IPv6 addresses are enclosed in brackets (e.g., [::1] or [fe80::1]) per
 * RFC 2732, so we check for that pattern first to avoid splitting on the
 * colons inside the address.
 */
export function extractHost(uri) {
  try {
    // Strip the protocol
    const withoutProto = uri.replace(/^[a-zA-Z+]+:\/\//, '');
    // Take everything up to the first / or ? or # (the authority component)
    const authority = withoutProto.split(/[/?#]/)[0];
    // Strip credentials: everything up to the LAST @ in the authority.
    // Using the last @ handles passwords that contain @.
    const lastAt = authority.lastIndexOf('@');
    const hostPortPart = lastAt >= 0 ? authority.slice(lastAt + 1) : authority;

    const hosts = [];

    // Check for IPv6 bracket notation: [address]:port or [address]
    // For replica sets: [addr1]:port,[addr2]:port,...
    if (hostPortPart.includes('[')) {
      const bracketRegex = /\[([^\]]+)\]/g;
      let match;
      while ((match = bracketRegex.exec(hostPortPart)) !== null) {
        hosts.push(safeDecodeHost(match[1]));
      }
      return hosts;
    }

    // IPv4 or hostname: comma-separated list of host:port pairs
    const hostList = hostPortPart.split(',').map(h => safeDecodeHost(h.split(':')[0].trim())).filter(Boolean);
    return hostList;
  } catch {
    return [];
  }
}

/**
 * Resolve a hostname to all its IP addresses using dns.resolve4 and
 * dns.resolve6. Also checks dns.lookup as a fallback (which includes
 * /etc/hosts entries).
 *
 * Returns an array of IP address strings.
 */
async function resolveHost(hostname) {
  const ips = new Set();

  // Try A records (IPv4)
  try {
    const v4 = await dns.resolve4(hostname);
    if (v4) v4.forEach(ip => ips.add(ip));
  } catch (e) {
    // ENOTFOUND is expected for invalid hosts — not an error here
    if (e.code !== 'ENOTFOUND' && e.code !== 'ENODATA') {
      logger.debug(`[ssrf-guard] dns.resolve4(${hostname}) error: ${e.code}`);
    }
  }

  // Try AAAA records (IPv6)
  try {
    const v6 = await dns.resolve6(hostname);
    if (v6) v6.forEach(ip => ips.add(ip));
  } catch (e) {
    if (e.code !== 'ENOTFOUND' && e.code !== 'ENODATA') {
      logger.debug(`[ssrf-guard] dns.resolve6(${hostname}) error: ${e.code}`);
    }
  }

  // Fallback: dns.lookup (respects /etc/hosts, system resolver). This is the
  // path that resolves entries in /etc/hosts and, importantly, is the same
  // code path the drivers themselves will use to turn the hostname into an
  // address — so if it can resolve it, we must see the answer.
  if (ips.size === 0) {
    try {
      const lookupResult = await dns.lookup(hostname, { all: true });
      if (lookupResult) {
        for (const entry of lookupResult) {
          ips.add(entry.address);
        }
      }
    } catch (e) {
      // Host not found — will be caught by the caller
    }
  }

  return [...ips];
}

/**
 * Check whether a database URI is safe to connect to.
 *
 * Resolves all hostnames in the URI and verifies that every resolved IP
 * address is in a public range. If any IP is private/reserved/loopback,
 * the URI is rejected.
 *
 * @param {string} uri — The database URI to check
 * @returns {{ safe: boolean, reason: string }}
 */
export async function assertSafeUri(uri) {
  const hosts = extractHost(uri);
  if (hosts.length === 0) {
    return { safe: false, reason: 'No hostname found in URI' };
  }

  // mongodb+srv:// carries a discovery name, not an address. The driver will
  // follow its SRV record to the real hosts, so those are what we must vet.
  if (/^mongodb\+srv:\/\//i.test(uri)) {
    for (const hostname of hosts) {
      const targets = await resolveMongoSrvTargets(hostname);
      for (const target of targets) {
        const verdict = await validateHost(target);
        if (verdict) {
          logger.warn(`[ssrf-guard] Rejecting SRV target ${target} of ${hostname}: ${verdict}`);
          return {
            safe: false,
            reason: `SRV target ${target} of ${hostname} is internal: ${verdict}`,
          };
        }
      }
      if (targets.length) {
        logger.debug(`[ssrf-guard] ${hostname}: ${targets.length} SRV target(s) cleared`);
      }
    }
  }

  for (const rawHost of hosts) {
    const verdict = await validateHost(rawHost);
    if (verdict) {
      return { safe: false, reason: verdict };
    }
  }

  return { safe: true, reason: 'OK' };
}

/**
 * Validates an HTTP/HTTPS endpoint URL against SSRF (private/internal/reserved addresses).
 * Rejects non-HTTP protocols, malformed URLs, and internal/loopback/cloud metadata destinations.
 *
 * @param {string} url - The HTTP/HTTPS URL to check
 * @returns {Promise<{ safe: boolean, reason: string }>}
 */
export async function assertSafeHttpUrl(url) {
  if (!url || typeof url !== 'string') {
    return { safe: false, reason: 'URL must be a non-empty string' };
  }
  const trimmed = url.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Unsupported protocol ${parsed.protocol} — only http: and https: are allowed` };
  }
  return await assertSafeUri(trimmed);
}

/**
 * Validate a single hostname or IP literal.
 *
 * @returns {string|null} a human-readable reason if blocked, or null if OK.
 */
async function validateHost(hostname) {
  // Canonicalise FIRST, before any pattern matching, and on every path into
  // this function — including SRV targets and comma-separated replica-set
  // members. URL-decode any percent-encoded characters (%2e, %30, etc.)
  // before checking so encoded bypasses cannot circumvent the blocklist.
  const raw = safeDecodeHost(hostname);
  const canonical = canonicalizeNumericHost(raw);

  // Reject any numeric address that is not already in canonical dotted-quad
  // form, whatever it canonicalises to.
  //
  // This is deliberately harsher than "canonicalise, then check the result",
  // because the canonicalisation itself is not portable. Measured on the two
  // platforms this project runs on:
  //
  //   host            macOS (dev)      Debian/glibc (prod, node:22-bookworm)
  //   0177.0.0.1      177.0.0.1        127.0.0.1          <-- disagrees
  //   012.0.0.1       12.0.0.1         10.0.0.1           <-- disagrees
  //   0300.0250.0.1   192.168.0.1      192.168.0.1
  //   2130706433      127.0.0.1        127.0.0.1
  //
  // macOS even disagrees with itself: it read 0177.0.0.1 as decimal but
  // 0300.0250.0.1 as octal. So there is no single "what the resolver will do"
  // answer to canonicalise against — and in the environment that matters
  // (production, glibc) the leading-zero forms ARE loopback/RFC1918.
  //
  // No legitimate connection string spells an address this way, so the right
  // move is to refuse the ambiguity instead of betting on a libc.
  if (canonical && canonical !== raw) {
    logger.warn(`[ssrf-guard] Rejecting non-canonical numeric host ${raw} (would canonicalise to ${canonical} on glibc)`);
    return `Blocked non-canonical numeric address: ${raw}`;
  }

  const host = canonical || raw;
  if (!host) return 'Empty hostname in URI';

  // Quick string check for obvious internal addresses before DNS
  if (/^(0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host)) {
    logger.warn(`[ssrf-guard] Rejecting URI with private hostname: ${host}`);
    return `Blocked private/internal address: ${host}`;
  }

  if (host.toLowerCase() === 'localhost' || host.toLowerCase() === 'localhost.localdomain'
      || host === '::1' || host === '[::1]' || host === '::' || host === '[::]') {
    logger.warn(`[ssrf-guard] Rejecting URI with localhost hostname`);
    return 'Blocked localhost address';
  }

  // Quick IPv6 check for private ranges (fe80::, fc00::, ff00::)
  if (/^(fe[89ab]|fe[89ab][0-9a-f]{2}:)/i.test(host) ||
      /^(fc|fd)[0-9a-f]{2}:/i.test(host) ||
      /^ff[0-9a-f]{2}:/i.test(host)) {
    logger.warn(`[ssrf-guard] Rejecting URI with private IPv6 hostname: ${host}`);
    return `Blocked private/internal IPv6: ${host}`;
  }

  // If it's already an IP address, check directly
  // IPv4: 1.2.3.4 or IPv6: ::1, fe80::1, etc.
  const looksLikeIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const looksLikeIPv6 = host.includes(':') || host.startsWith('[');
  if (looksLikeIPv4 || looksLikeIPv6) {
    const cleanIP = host.replace(/^\[|\]$/g, '');
    if (isBlockedIP(cleanIP)) {
      logger.warn(`[ssrf-guard] Rejecting URI with blocked IP: ${cleanIP}`);
      return `Blocked private/internal IP: ${cleanIP}`;
    }
    return null; // IP is public
  }

  // Resolve DNS and check every answer — TWICE.
  //
  // The gap between our resolution and the driver's connect() is the DNS
  // rebinding window. We cannot close it from here, but requiring two
  // independent clean answers means an attacker must serve a benign record
  // for the duration of both lookups and only then flip, which is a much
  // narrower race than flipping after a single answer.
  const first = await resolveHost(host);
  if (first.length === 0) {
    // Can't resolve — let the connection attempt proceed and fail naturally.
    // Don't block here because DNS resolution might work differently from
    // the server's perspective (e.g., split-horizon DNS, or the host is
    // genuinely new and not yet resolvable).
    logger.debug(`[ssrf-guard] Could not resolve ${host} — allowing connection to fail naturally`);
    return null;
  }

  for (const ip of first) {
    if (isBlockedIP(ip)) {
      logger.warn(`[ssrf-guard] Rejecting URI: ${host} resolves to blocked IP ${ip}`);
      return `Host ${host} resolves to private/internal IP: ${ip}`;
    }
  }

  const second = await resolveHost(host);
  for (const ip of second) {
    if (isBlockedIP(ip)) {
      logger.warn(`[ssrf-guard] Rejecting URI: ${host} re-resolved to blocked IP ${ip} (possible DNS rebinding)`);
      return `Host ${host} re-resolved to private/internal IP: ${ip}`;
    }
  }

  if (second.length > 0 && first.length !== second.length) {
    // Answer set changed between lookups. Not proof of an attack, but the
    // second answer is the one we did not fully vet against the first set.
    logger.warn(`[ssrf-guard] ${host}: DNS answer set changed between lookups (${first.length} → ${second.length})`);
  }

  return null;
}
