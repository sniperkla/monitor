/**
 * serverJwt.js
 *
 * Parse the next-auth v4 session JWT from a raw Node.js IncomingMessage.
 * Handles plain and chunked session cookies (next-auth splits large tokens).
 */

const COOKIE_NAMES = [
  'next-auth.session-token',           // http / dev
  '__Secure-next-auth.session-token',  // https / prod
];

function parseCookies(req) {
  const header = req.headers['cookie'] || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    try {
      cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      cookies[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return cookies;
}

function getTokenFromCookies(cookies) {
  // 1. Plain cookie
  for (const name of COOKIE_NAMES) {
    if (cookies[name]) return cookies[name];
  }
  // 2. Chunked cookie (next-auth splits big JWTs into .0, .1, ...)
  for (const name of COOKIE_NAMES) {
    if (cookies[`${name}.0`]) {
      let combined = '';
      let i = 0;
      while (cookies[`${name}.${i}`] !== undefined) {
        combined += cookies[`${name}.${i}`];
        i++;
      }
      if (combined) return combined;
    }
  }
  return null;
}

/**
 * Decode the next-auth JWT and return the full payload object.
 * Returns null if no cookie or decode fails.
 */
async function parseJwtPayload(req) {
  try {
    const cookies = parseCookies(req);
    const token = getTokenFromCookies(cookies);

    if (!token) return null;

    const secret =
      process.env.NEXTAUTH_SECRET ||
      process.env.ENCRYPTION_KEY ||
      'b5caf31cfa8c03a8ac8350f76e35eee30ed4e1d57f25596f900a558e6c98c04e';

    const { decode } = await import('next-auth/jwt');
    const payload = await decode({ token, secret });
    return payload || null;
  } catch (err) {
    console.warn('[serverJwt] decode error:', err.message);
    return null;
  }
}

async function parseJwtEmail(req) {
  const p = await parseJwtPayload(req);
  return p?.email || null;
}

async function parseJwtRole(req) {
  const p = await parseJwtPayload(req);
  return p?.role || null;
}

module.exports = { parseJwtPayload, parseJwtEmail, parseJwtRole };
