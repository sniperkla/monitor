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

/**
 * Which file the installer hands out. Kept in one place so they cannot drift.
 *
 * This is the BUILT artifact, not the source, and it must stay that way: the
 * manifest digest has to describe the bytes /local-relay.js actually serves, or
 * the verify-before-run step fails for everyone. scripts/build-relay.mjs is
 * deterministic (fixed seed), so the digest is stable for a given source.
 */
export const RELAY_FILENAME = 'local-relay.min.js';

const RELAY_PATH = path.join(process.cwd(), 'public', RELAY_FILENAME);

/** Cache the digest. The file changes only on deploy. */
let cache = null; // { mtimeMs, size, sha256, etag }
let latestPackageCache = { version: null, checkedAt: 0 };
const PACKAGE_NAME = 'ssh-monitor-relay';
const PACKAGE_CHECK_TTL_MS = 10 * 60 * 1000;

async function readLatestPackageVersion() {
  if (latestPackageCache.version && Date.now() - latestPackageCache.checkedAt < PACKAGE_CHECK_TTL_MS) {
    return latestPackageCache.version;
  }
  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return latestPackageCache.version;
    const data = await response.json();
    if (typeof data.version === 'string' && /^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$/.test(data.version)) {
      latestPackageCache = { version: data.version, checkedAt: Date.now() };
    }
  } catch (_) {
    // npm availability must never block the relay installer or status page.
  }
  return latestPackageCache.version;
}

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
    const latestVersion = await readLatestPackageVersion();

    // Browser caches the manifest; a deploy changes the file and the ETag.
    if (request.headers.get('if-none-match') === manifest.etag) {
      return new Response(null, { status: 304, headers: { ETag: manifest.etag } });
    }

    return Response.json(
      {
        success: true,
        file: RELAY_FILENAME,
        package: PACKAGE_NAME,
        latestVersion,
        // The public installer URL. It serves the same bytes as the hashed
        // artifact — server.js maps /local-relay.js onto local-relay.min.js.
        url: '/local-relay.js',
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
      { success: false, error: 'Relay release manifest is unavailable.', latestVersion: latestPackageCache.version },
      { status: 404 }
    );
  }
}
