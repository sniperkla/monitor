import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * GET /api/relay/release — integrity manifest for the relay agent.
 *
 * WHY THIS EXISTS
 * ---------------
 * The install command downloads a script and runs it. That is the single
 * biggest reason a careful user walks away: there is nothing in the UI letting
 * them check that the bytes they just pulled are the bytes we published.
 *
 * This endpoint publishes the fingerprint of the exact file we serve, so the
 * installer can show a SHA-256 and offer a verify-before-run path. It proves
 * nothing about whether *we* are trustworthy — it proves the download was not
 * tampered with or stale, which is the part the user can actually check.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It is not a signature. A checksum served from the same origin as the file it
 * describes cannot defend against a compromise of that origin; only an
 * out-of-band code signature can. The UI says so plainly rather than dressing
 * this up as more than it is.
 *
 * Session-protected by the proxy: Settings reads this only after the user has
 * signed in. The relay source itself remains public at /local-relay.js; keeping
 * the manifest behind the dashboard avoids growing the unauthenticated API
 * surface merely to reveal metadata that the installer does not need first.
 */

/** Which file the installer hands out. Kept in one place so they cannot drift. */
export const RELAY_FILENAME = 'local-relay.js';

const RELAY_PATH = path.join(process.cwd(), 'public', RELAY_FILENAME);

/** Cache the digest. The file changes only on deploy. */
let cache = null; // { mtimeMs, size, sha256, etag }

async function readManifest() {
  const stat = await fs.stat(RELAY_PATH);
  if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
    return cache;
  }

  const buf = await fs.readFile(RELAY_PATH);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const etag = `"${sha256.slice(0, 32)}-${stat.size.toString(16)}"`;

  cache = { mtimeMs: stat.mtimeMs, size: stat.size, sha256, etag };
  return cache;
}

export async function GET(request) {
  try {
    const manifest = await readManifest();

    // Browser caches the manifest; a deploy changes the file and the ETag.
    if (request.headers.get('if-none-match') === manifest.etag) {
      return new Response(null, { status: 304, headers: { ETag: manifest.etag } });
    }

    return Response.json(
      {
        success: true,
        file: RELAY_FILENAME,
        url: `/${RELAY_FILENAME}`,
        sha256: manifest.sha256,
        bytes: manifest.size,
        verifiedAt: new Date(manifest.mtimeMs).toISOString(),
      },
      {
        headers: {
          ETag: manifest.etag,
          // Short-lived: the manifest must follow a deploy quickly, but should
          // not be re-requested on every render of the installer.
          'Cache-Control': 'public, max-age=60, must-revalidate',
        },
      }
    );
  } catch (err) {
    return Response.json(
      { success: false, error: 'Relay release manifest is unavailable.' },
      { status: 404 }
    );
  }
}
