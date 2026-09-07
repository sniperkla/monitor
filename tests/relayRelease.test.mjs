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
const serverSrc = readSrc('server.js');
const pkg = JSON.parse(readSrc('package.json'));

test('release manifest hashes the exact bytes the installer serves', () => {
  assert.match(releaseRoute, /export const RELAY_FILENAME = 'local-relay\.min\.js'/,
    'manifest must hash the built artifact — that is what /local-relay.js serves');
  assert.match(releaseRoute, /path\.join\(process\.cwd\(\), 'public', RELAY_FILENAME\)/,
    'hash must be computed from the served artifact, not a stale copy');
  assert.match(releaseRoute, /createHash\('sha256'\)\.update\(buf\)\.digest\('hex'\)/,
    'manifest must publish an actual SHA-256 digest');
  assert.match(releaseRoute, /url: '\/local-relay\.js'/,
    'manifest download URL must be the public installer path the server maps onto the artifact');
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

// F1, retargeted — the manifest hashes public/local-relay.min.js, so the static
// handler must serve that same artifact. The original finding was "the served
// file must equal the hashed file, or verify-before-run fails for everyone";
// that invariant still holds, it just now points at the artifact.
//
// The second half is the new hazard this split introduces: an artifact that
// silently stops tracking its source. That is why the builder is seeded and
// stamps `source-sha256`, and why a missing artifact is a 503 rather than a
// fallback to the readable source.
test('the server serves the exact artifact the manifest hashes', () => {
  assert.match(serverSrc, /path\.join\(__dirname, 'public', 'local-relay\.min\.js'\)/,
    'the /local-relay.js handler must resolve to the built artifact');
  assert.match(serverSrc, /res\.statusCode = 503/,
    'a missing artifact must fail loudly, not fall back to the readable source');
  assert.doesNotMatch(serverSrc, /'public', 'local-relay\.js'\)/,
    'server.js must never serve the readable relay source over HTTP');
  assert.equal(pkg.scripts['build:relay'], 'node scripts/build-relay.mjs',
    'the artifact must have a build step, or it cannot exist in a fresh checkout');
  assert.match(pkg.scripts.prebuild, /build:relay/,
    'building the app must build the relay first, or prod serves a 503');
});

test('the relay artifact is deterministic and declares its source', () => {
  const builder = readSrc('scripts/build-relay.mjs');

  assert.match(builder, /const SEED = \d+;/,
    'a fixed seed is what makes the artifact checksummable and drift-checkable');
  assert.match(builder, /seed: SEED/, 'the seed must actually reach the obfuscator');
  assert.match(builder, /source-sha256: \$\{sourceHash\}/,
    'the artifact must stamp the source it was built from, so staleness is detectable');
  assert.match(builder, /process\.exit\(2\)/,
    '--check must fail non-zero when the artifact is stale or missing');
  assert.match(builder, /const rebuilt = buildArtifact\(/,
    '--check must rebuild through the same function the build uses, or it compares different bytes');
  assert.match(builder, /const out = buildArtifact\(/,
    'the build path must use the shared artifact builder too');

  // The options that break real code. The relay resolves modules through a
  // dynamic require() search path that these have corrupted before, so they
  // must stay off no matter who "improves" the config later.
  for (const off of ['controlFlowFlattening: false', 'deadCodeInjection: false', 'selfDefending: false']) {
    assert.match(builder, new RegExp(off), `${off} — these transforms break the relay's dynamic require()`);
  }
  // …and the ones that do the actual work must stay on.
  assert.match(builder, /renameGlobals: true/, 'without this every top-level name survives verbatim');
  assert.match(builder, /stringArrayThreshold: 1/, 'a lower threshold leaks literals straight through');
});

// ── npm install route ─────────────────────────────────────────────────────
//
// The npm package exists so nobody has to pipe a download into node. That only
// helps if the installer actually offers it — an option buried inside a
// collapsed "before you run it" disclosure is an option nobody finds. These
// checks pin it as a first-class install method in the Local Relay Agent modal.

test('relay installer offers npm as a first-class install method', () => {
  const settingsApp = readSrc('src/apps/SettingsApp.js');

  assert.match(settingsApp, /const \[relayInstallMethod, setRelayInstallMethod\] = useState\('npm'\)/,
    'install method must default to npm, not to the curl one-liner');

  assert.match(settingsApp, /<InstallMethodToggle method=\{relayInstallMethod\} onChange=\{setRelayInstallMethod\} \/>/,
    'the installer must render a switch between npm and direct download');

  // Step 1 is the block the user actually reads. It must follow the selection
  // rather than hard-coding the curl one-liner.
  assert.match(settingsApp, /const getRelayInstallSnippet = \(\) =>\s*\n\s*relayInstallMethod === 'npm'/,
    'the step 1 snippet must branch on the selected method');
  assert.match(settingsApp, /\{getRelayInstallSnippet\(\)\}/,
    'step 1 must render the method-aware snippet');

  // The copy buttons must not silently hand back the curl command.
  const copySites = settingsApp.match(/navigator\.clipboard\.writeText\(getRelayInstallSnippet\(\)\)/g) || [];
  assert.ok(copySites.length >= 3,
    `every install copy button must use the method-aware snippet (found ${copySites.length})`);
  assert.doesNotMatch(settingsApp, /writeText\(getRelayOneLiner\('install'\)\)/,
    'no copy button may keep hard-coding the curl install one-liner');
});

test('the advertised npm package is the one the trust panel defines', () => {
  const settingsApp = readSrc('src/apps/SettingsApp.js');

  assert.match(trustPanel, /export const NPM_PACKAGE = 'ssh-monitor-relay'/,
    'the package name must live in one place');
  assert.match(settingsApp, /import RelayTrustPanel, \{[\s\S]*?NPM_PACKAGE,/,
    'Settings must import the package name rather than re-declaring it');
  assert.doesNotMatch(settingsApp, /const NPM_PACKAGE = /,
    'the package name must not be duplicated in Settings');
});

test('npm uninstall stops the service before it removes the binary', () => {
  const fn = trustPanel.slice(trustPanel.indexOf('export function npmUninstallCommand'));
  assert.ok(fn.includes('local-relay --uninstall') && fn.includes('npm uninstall -g'),
    'the npm uninstall snippet must cover both the service and the package');
  assert.ok(
    fn.indexOf('local-relay --uninstall') < fn.indexOf('npm uninstall -g'),
    '`local-relay --uninstall` must run first — after `npm uninstall` the binary is gone'
  );
});

// ── --pair must always produce a code ─────────────────────────────────────
//
// Reported as "no key appear after installed via npm or direct ... need to
// remove first when install again". Both symptoms are one bug: the pairing
// call was gated on `if (!TOKEN)`, and TOKEN is seeded from the saved config,
// so on an already-paired machine `--pair` skipped pairing entirely and printed
// no code — just the success line. `--uninstall` only appeared to fix it
// because it deletes the config that was short-circuiting the check.
test('--pair mints a new code even when a token is already saved', () => {
  const relay = readSrc('public/local-relay.js');

  assert.match(relay, /let TOKEN\s*=\s*args\.token\s*\|\| savedConfig\.token/,
    'the saved token still seeds TOKEN — the guard below is what must account for it');

  // The fix. A bare `if (!TOKEN)` is the bug.
  assert.match(relay, /if \(!TOKEN \|\| \(args\.pair && !args\.token\)\)/,
    'pairing must run when there is no token OR when --pair was explicitly asked for');
  assert.doesNotMatch(relay, /if \(!TOKEN\) \{\n\s*try \{\n\s*TOKEN = await pairAndGetToken/,
    'a bare `if (!TOKEN)` silently skips pairing — the reported no-code bug');

  // An explicit --token is a credential the user supplied; do not override it.
  assert.match(relay, /args\.pair && !args\.token/,
    'an explicit --token must win over --pair, so the fresh-code path excludes it');

  // Re-pairing overwrites a credential, so say so.
  assert.match(relay, /Already paired — replacing the existing token/,
    're-pairing must tell the user the old token is being discarded');
});

test('the relay warns when a saved token is used against a different server', () => {
  const relay = readSrc('public/local-relay.js');
  assert.match(relay, /savedConfig\.server !== SERVER && TOKEN === savedConfig\.token/,
    'a token only works on the server that minted it — warn instead of writing a dead config');
  assert.match(relay, /re-run with --pair to get a fresh one/,
    'the warning must name the recovery command');
});

test('connected relays report their version for update notices', () => {
  const relay = readSrc('public/local-relay.js');
  const server = readSrc('server.js');
  const route = readSrc('src/app/api/relay/token/route.js');
  const release = readSrc('src/app/api/relay/release/route.js');
  const settingsApp = readSrc('src/apps/SettingsApp.js');
  assert.match(relay, /const RELAY_VERSION = '[0-9]+\.[0-9]+\.[0-9]+'/);
  assert.match(relay, /type: 'init', relayName: RELAY_NAME, version: RELAY_VERSION/);
  assert.match(server, /r\.version = typeof msg\.version === 'string'/);
  assert.match(route, /version: relay\.version \|\| null/);
  assert.match(release, /registry\.npmjs\.org\/\$\{PACKAGE_NAME\}\/latest/);
  assert.match(release, /latestVersion/);
  assert.match(settingsApp, /isRelayVersionOlder\(relay\.version, relayRelease\?\.latestVersion\)/);
});
