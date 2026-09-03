/**
 * Canonical client-IP resolution.
 *
 * Every rate limiter, audit entry, and blocklist in this app needs "who is
 * asking". They used to each answer that question differently — most by taking
 * the FIRST entry in x-forwarded-for — which is wrong, because XFF is a
 * client-controlled header:
 *
 *     curl -H 'x-forwarded-for: 1.2.3.4' https://monitor.eaqdragon.com/...
 *
 * With the old leftmost-wins logic, that attacker picks their own rate-limit
 * bucket and writes their own IP into the audit trail. Confirmed live: a fixed
 * spoofed IP was rate-limited after 30 requests (matching `csrf: max 30`),
 * while rotating the spoofed IP on every request was never limited at all —
 * 35/35 succeeded.
 *
 * TOPOLOGY (from deploy/nginx/*.conf)
 *
 *     client -> Cloudflare -> nginx -> Next.js
 *
 * nginx sets:
 *     X-Real-IP        = $remote_addr                  (OVERWRITES)
 *     X-Forwarded-For  = $proxy_add_x_forwarded_for    (APPENDS)
 *
 * So X-Real-IP is trustworthy but only identifies the immediate peer (a
 * Cloudflare egress IP, or the real client when Cloudflare is bypassed). XFF
 * carries the real client, but with attacker-supplied entries on the left.
 *
 * RESOLUTION ORDER
 *
 *   1. CF-Connecting-IP  — Cloudflare sets this to the true client and
 *      overwrites any client-supplied value. Authoritative while traffic
 *      passes through Cloudflare.
 *   2. True-Client-IP    — Cloudflare Enterprise variant, same guarantee.
 *   3. XFF at a trusted index — counting from the RIGHT, past the entries our
 *      own proxies appended. See TRUSTED_PROXY_HOPS below.
 *   4. X-Real-IP         — overwritten by our nginx, so unspoofable, but it
 *      names the immediate peer rather than the origin client.
 *   5. 'unknown'         — deliberately NOT the leftmost XFF entry.
 *
 * Falling back to 'unknown' rather than the spoofable leftmost entry is the
 * whole point. A shared bucket still enforces a limit; an attacker-chosen
 * bucket enforces nothing. Likewise for the audit trail: an absent IP is
 * honest, a spoofed one is actively misleading.
 *
 * RESIDUAL RISK
 *
 * If the origin is directly reachable (Cloudflare bypassed), a client can set
 * CF-Connecting-IP themselves. Prevent that at the network layer by firewalling
 * the origin to Cloudflare's published IP ranges — it cannot be fixed here.
 */

/**
 * Number of reverse-proxy hops in front of this app that we trust to append
 * to x-forwarded-for.
 *
 * 0 = no proxy; do not read XFF at all (it is entirely client-supplied).
 * 1 = one hop (a direct nginx, or Cloudflare terminating straight to the app).
 * 2 = Cloudflare in front of nginx — the deployed topology.
 *
 * The real client is the entry `parts[parts.length - N]`:
 *
 *   N=2, XFF = "9.9.9.9, 1.2.3.4, <cf-egress>"
 *              ^attacker  ^real    ^nginx appended
 *   len=3  ->  idx = 3 - 2 = 1  ->  "1.2.3.4"  correct.
 *
 * NOTE: an earlier implementation used `parts.length - N - 1`, which is off by
 * one and lands on an attacker-controlled entry. With N=2 and the header above
 * it would return "9.9.9.9" — i.e. enabling the trusted-hop feature still
 * yielded a spoofable IP. The index is `len - N`.
 *
 * If the client sent no XFF at all, `len - N` is negative; then the first
 * entry is one our own proxy wrote, and it is the real client.
 */
const TRUSTED_PROXY_HOPS = (() => {
  const n = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 2; // default matches Cloudflare + nginx
})();

/**
 * True when we are willing to read headers that only a proxy should set.
 * When false, only the (unspoofable but peer-level) X-Real-IP is used.
 */
const TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS !== '0';

/** Loose shape check — enough to reject junk without a full parser. */
const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:.]+$/;

/**
 * Read a header from either shape.
 *
 * Callers see both: Next.js route handlers get a Fetch `Headers` instance, but
 * NextAuth's authorize() may hand over a plain object depending on which entry
 * point invoked it. Both shapes occur in this codebase today, so normalise
 * once here instead of at every call site.
 *
 * @param {Request|{headers: object}} request
 */
function headerValue(request, name) {
  const h = request?.headers;
  if (!h) return '';
  try {
    if (typeof h.get === 'function') return h.get(name) ?? h.get(name.toLowerCase()) ?? '';
    return h[name] ?? h[String(name).toLowerCase()] ?? '';
  } catch {
    return '';
  }
}

/**
 * Reduce a header value to a single usable IP string, or ''.
 * Rejects anything with an embedded comma (a whole XFF chain pasted into a
 * single-IP header) and anything that is not shaped like an address, so a
 * hostile value cannot become a unique rate-limit bucket.
 */
function sanitizeIp(value) {
  if (!value) return '';
  const ip = String(value).trim();
  if (!ip || ip.length > 45) return ''; // 45 = max IPv6-mapped length
  if (ip.includes(',')) return '';
  // Strip any zone index / port remnants.
  const cleaned = ip.replace(/^\[|\]$/g, '').split('%')[0];
  if (IPV4.test(cleaned)) {
    // Reject out-of-range octets so "999.999.999.999" cannot be a bucket.
    return cleaned.split('.').every((o) => Number(o) <= 255) ? cleaned : '';
  }
  if (IPV6.test(cleaned) && cleaned.includes(':')) return cleaned.toLowerCase();
  return '';
}

/**
 * Resolve the client IP for a Next.js Request / NextRequest.
 *
 * @param {Request} request
 * @returns {string} an IP address, or 'unknown'
 */
export function getClientIp(request) {
  return getClientIpInfo(request).ip;
}

/**
 * Same as getClientIp(), but also reports which header won. Useful in audit
 * records and when debugging a deployment's proxy configuration — "why is
 * everyone bucketed as unknown" is otherwise unanswerable from the logs.
 *
 * @param {Request} request
 * @returns {{ ip: string, source: string }}
 */
export function getClientIpInfo(request) {
  // 1 & 2. Cloudflare's own headers. Overwritten by Cloudflare on every
  // request it proxies, so a client-supplied value cannot survive the trip.
  if (TRUST_PROXY_HEADERS) {
    const cf = sanitizeIp(headerValue(request, 'cf-connecting-ip'));
    if (cf) return { ip: cf, source: 'cf-connecting-ip' };

    const tc = sanitizeIp(headerValue(request, 'true-client-ip'));
    if (tc) return { ip: tc, source: 'true-client-ip' };
  }

  // 3. XFF, counting in from the right past our own proxies' entries.
  const xff = headerValue(request, 'x-forwarded-for');
  if (xff && TRUSTED_PROXY_HOPS > 0) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    // Take the trusted slot; if the header is shorter than the hop count, the
    // first entry was written by our own edge and is the real client.
    const idx = parts.length - TRUSTED_PROXY_HOPS;
    const candidate = idx >= 0 ? parts[idx] : parts[0];
    const ip = sanitizeIp(candidate);
    if (ip) return { ip, source: idx >= 0 ? 'x-forwarded-for[trusted]' : 'x-forwarded-for[edge]' };
  }

  // 4. X-Real-IP — our nginx overwrites it, so it cannot be spoofed, though it
  // names the immediate peer (Cloudflare) rather than the origin client.
  const real = sanitizeIp(headerValue(request, 'x-real-ip'));
  if (real) return { ip: real, source: 'x-real-ip' };

  // 5. Deliberately not the leftmost XFF entry — see the module docstring.
  return { ip: 'unknown', source: 'unresolved' };
}

/**
 * Exposed for tests and for the health/debug surfaces.
 * @returns {number}
 */
export function getTrustedProxyHops() {
  return TRUSTED_PROXY_HOPS;
}
