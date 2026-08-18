/**
 * GET /api/p/key
 *
 * Bootstrap endpoint — returns the per-session proxy key so the client
 * can encrypt all subsequent API traffic through POST /api/p.
 *
 * The key is returned as a raw base64 string over HTTPS.
 * In DevTools it just looks like a single short base64 blob.
 *
 * Only callable by authenticated sessions.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { cookies } from 'next/headers';
import { deriveProxyKey } from '@/lib/proxyKey';

const COOKIE_NAMES = [
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Read the raw session token from the cookie store
  const cookieStore = await cookies();
  let sessionToken = null;
  for (const name of COOKIE_NAMES) {
    const c = cookieStore.get(name);
    if (c?.value) { sessionToken = c.value; break; }
  }

  // Handle chunked cookies (next-auth splits large JWTs into .0, .1, ...)
  if (!sessionToken) {
    for (const name of COOKIE_NAMES) {
      let combined = '';
      let i = 0;
      while (true) {
        const c = cookieStore.get(`${name}.${i}`);
        if (!c?.value) break;
        combined += c.value;
        i++;
      }
      if (combined) { sessionToken = combined; break; }
    }
  }

  if (!sessionToken) {
    return NextResponse.json({ error: 'Session token not found' }, { status: 401 });
  }

  const keyBuf = deriveProxyKey(sessionToken);

  return NextResponse.json(
    { key: keyBuf.toString('base64') },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    }
  );
}
