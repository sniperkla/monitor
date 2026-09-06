// ── Regression test: relay release manifest contract ───────────────────────
//
// The trust panel gives an operator a locally verifiable SHA-256 before it asks
// them to execute the relay. These are deliberately source-level checks: route
// handlers depend on Next's runtime aliases, whereas this test's job is to pin
// the security contract, not to emulate Next.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const releaseRoute = readSrc('src/app/api/relay/release/route.js');
const trustPanel = readSrc('src/components/RelayTrustPanel.js');
const proxy = readSrc('src/proxy.js');

test('release manifest hashes the exact public relay file', () => {
  assert.match(releaseRoute, /export const RELAY_FILENAME = 'local-relay\.js'/,
    'manifest must name the same relay script the installer serves');
  assert.match(releaseRoute, /path\.join\(process\.cwd\(\), 'public', RELAY_FILENAME\)/,
    'hash must be computed from public/local-relay.js, not a copy or build artifact');
  assert.match(releaseRoute, /createHash\('sha256'\)\.update\(buf\)\.digest\('hex'\)/,
    'manifest must publish an actual SHA-256 digest');
  assert.match(releaseRoute, /url: `\/\$\{RELAY_FILENAME\}`/,
    'manifest download URL must resolve to the public relay file');
});

test('manifest response supports safe cache revalidation', () => {
  assert.match(releaseRoute, /if-none-match/, 'client ETag must be checked');
  assert.match(releaseRoute, /status: 304/, 'matching ETag must return 304');
  assert.match(releaseRoute, /Cache-Control': 'public, max-age=60, must-revalidate'/,
    'manifest cache must be short-lived and revalidate after deploys');
});

test('verify-before-run UI gates execution on the digest check', () => {
  assert.match(trustPanel, /echo "\$\{sha\}  local-relay\.js" \| \$\{hasher\} -c -/,
    'Unix command must check the download before executing it');
  assert.match(trustPanel, /CHECKSUM MISMATCH - deleting\./,
    'Windows command must stop and remove a mismatched download');
  assert.match(trustPanel, /out-of-band code signature, which we do not ship yet/,
    'UI must not overstate a same-origin checksum as a code signature');
});

test('manifest stays behind the dashboard session gate', () => {
  assert.doesNotMatch(proxy, /\/api\/relay\/release/,
    'release manifest must not be added to a proxy session-bypass allowlist');
  assert.match(releaseRoute, /Session-protected by the proxy/,
    'route documentation must match the actual middleware behaviour');
});
