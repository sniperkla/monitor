/**
 * POST /api/p — Encrypted API proxy.
 *
 * All frontend API calls are routed through here as AES-256-GCM encrypted blobs.
 * DevTools only ever shows: POST /api/p  with an opaque base64 body.
 *
 * Request body (raw text):  base64( iv[12] || tag[16] || encrypt( JSON payload ) )
 *
 * Decrypted JSON payload:
 *   {
 *     url:     "/api/connections",          — internal route to call
 *     method:  "GET" | "POST" | ...,
 *     headers: { "x-mongodb-uri": "..." },  — forwarded headers
 *     body:    "..." | null                 — stringified body
 *   }
 *
 * Response body (raw text): base64( iv[12] || tag[16] || encrypt( JSON response ) )
 *
 * Decrypted response:
 *   {
 *     status:  200,
 *     headers: { "content-type": "application/json" },
 *     body:    "..."   — stringified response body
 *   }
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { cookies } from 'next/headers';
import { deriveProxyKey, aesDecrypt, aesEncrypt } from '@/lib/proxyKey';

// Routes that must never be proxied through /api/p (auth, health, the proxy itself)
const BLOCKED_INTERNAL = ['/api/auth', '/api/p'];

const COOKIE_NAMES = [
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

async function getSessionToken() {
  const cookieStore = await cookies();
  for (const name of COOKIE_NAMES) {
    const c = cookieStore.get(name);
    if (c?.value) return c.value;
  }
  // Chunked
  for (const name of COOKIE_NAMES) {
    let combined = '';
    let i = 0;
    while (true) {
      const c = cookieStore.get(`${name}.${i}`);
      if (!c?.value) break;
      combined += c.value;
      i++;
    }
    if (combined) return combined;
  }
  return null;
}

export async function POST(request) {
  // 1. Auth check
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Derive the session key
  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    return NextResponse.json({ error: 'Session token not found' }, { status: 401 });
  }
  const keyBuf = deriveProxyKey(sessionToken);

  // 3. Read + decrypt the request payload
  let payload;
  try {
    const raw = await request.text();
    const decrypted = aesDecrypt(keyBuf, raw);
    payload = JSON.parse(decrypted.toString('utf8'));
  } catch (err) {
    return NextResponse.json({ error: 'Invalid encrypted payload' }, { status: 400 });
  }

  const { url, method = 'GET', headers: fwdHeaders = {}, body = null } = payload;

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Missing url in payload' }, { status: 400 });
  }

  // 4. Security: block proxying auth/proxy routes themselves
  if (BLOCKED_INTERNAL.some(prefix => url.startsWith(prefix))) {
    return NextResponse.json({ error: 'Forbidden proxy target' }, { status: 403 });
  }

  // 5. Forward the request internally to the actual Next.js route
  try {
    const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const internalUrl = `${base}${url}`;

    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        // Forward cookies so route handlers can auth via getServerSession
        'Cookie': request.headers.get('cookie') || '',
        ...fwdHeaders,
        // Mark as internal proxy call so routes can detect it if needed
        'X-Proxy-Internal': '1',
      },
    };
    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const internalRes = await fetch(internalUrl, fetchOptions);

    // 6. Read response
    const resBody = await internalRes.text();
    const resHeaders = {};
    for (const [k, v] of internalRes.headers.entries()) {
      // Forward content-type and rate-limit headers; skip set-cookie (handled by browser)
      if (
        k === 'content-type' ||
        k.startsWith('x-ratelimit') ||
        k === 'x-proxy-internal'
      ) {
        resHeaders[k] = v;
      }
    }

    // 7. Encrypt the response
    const responsePayload = JSON.stringify({
      status: internalRes.status,
      headers: resHeaders,
      body: resBody,
    });
    const encrypted = aesEncrypt(keyBuf, responsePayload);

    return new NextResponse(encrypted, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[/api/p] internal fetch error:', err.message);
    // Encrypt the error response too
    const errPayload = JSON.stringify({
      status: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy internal error' }),
    });
    const encrypted = aesEncrypt(keyBuf, errPayload);
    return new NextResponse(encrypted, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }
}
