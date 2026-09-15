// ── Regression test: OpenClaw gateway-secret auto-paste ────────────────────
//
// The user's report: "i still have problem on openclaw on Gateway secret can
// you auto paste ?" — OpenClaw's Control UI renders
//
//   This Gateway expects its token
//   … paste the token from `openclaw gateway auth-token --show` into Gateway secret
//
// and there is nothing on the monitor side to paste: the secret only exists on
// the gateway host.
//
// Two facts make the fix possible, and both were MEASURED on fc-fedora40
// rather than guessed (the first guess was wrong and inert):
//
//   1. the UI persists the secret in **sessionStorage** under a per-gateway key
//      `openclaw.control.token.v1:<gatewayUrl>` — NOT in localStorage. Seeding
//      localStorage['openclaw.control.settings.v1:<gw>'] with {gatewayUrl,token}
//      changes nothing: the connect frame still goes out with no `auth` object.
//      Because it is sessionStorage, the secret is per-TAB, which is why the
//      prompt returns on every new tab.
//   2. the token is readable only from the config FILE. `openclaw gateway
//      auth-token --show` refuses outside a TTY and `openclaw config get
//      gateway.auth.token` prints __OPENCLAW_REDACTED__.
//
// The tests below pin the pure pieces, the memoisation behaviour, and the proxy
// wiring. A wrong key or a wrong value is a SILENT failure — the UI just shows
// the prompt as if nothing were injected — so the shape has to be pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

// The module imports execCommand from _ssh.js, which drags in mongoose + ssh2 at
// load time. Same trick as multi-instance.test.mjs: load a copy with that one
// import swapped for a controllable stub, so the module is importable in bare
// node and the remote read can be driven from the test.
const MODULE = 'src/app/api/agents/_openclaw-gateway-token.js';
const source = readFileSync(MODULE, 'utf8').replace(
  /^import \{ execCommand \} from '@\/app\/api\/server-backup\/_ssh';$/m,
  'const execCommand = (...args) => globalThis.__exec(...args);'
);
assert.doesNotMatch(source, /_ssh/, 'the _ssh import must have been replaced');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'openclaw-token-'));
const modPath = path.join(tmp, '_openclaw-gateway-token.mjs');
writeFileSync(modPath, source);

const {
  OPENCLAW_TOKEN_CMD,
  OPENCLAW_TOKEN_KEY_PREFIX,
  OPENCLAW_SEED_MARK_PREFIX,
  parseOpenClawToken,
  parseOpenClawTokenAuth,
  openClawTokenStorageKey,
  openClawSeedMarkKey,
  readOpenClawGatewayToken,
  clearOpenClawTokenCache,
} = await import(`file://${modPath}`);

/** Point the stub at a scripted remote, recording every invocation. */
function scriptRemote(handler) {
  globalThis.__calls = [];
  globalThis.__exec = async (sshConfig, cmd, opts) => {
    globalThis.__calls.push({ sshConfig, cmd, opts });
    return handler(cmd);
  };
}

test('parseOpenClawToken pulls the value out of the marker line', () => {
  assert.equal(parseOpenClawToken('OCTOKEN=abc123\n'), 'abc123');
  // The remote prints a trailing newline; a CRLF shell must not smuggle a \r
  // into the secret, or the gateway sees a mismatch for a token that is correct.
  assert.equal(parseOpenClawToken('OCTOKEN=abc123\r\n'), 'abc123');
  // Other chatter on stdout (motd, warnings) must not defeat the parse.
  assert.equal(parseOpenClawToken('warning: something\nOCTOKEN=deadbeef\nbye\n'), 'deadbeef');
});

test('parseOpenClawToken refuses to invent a token', () => {
  // No marker at all.
  assert.equal(parseOpenClawToken(''), '');
  assert.equal(parseOpenClawToken(null), '');
  assert.equal(parseOpenClawToken(undefined), '');
  assert.equal(parseOpenClawToken('command not found\n'), '');
  // Marker present but empty: the file was missing or python3 is absent. An
  // empty secret must NOT be handed to the UI — an empty string is a *wrong*
  // secret, which produces a confusing token_mismatch instead of the honest
  // prompt the user already understands.
  assert.equal(parseOpenClawToken('OCTOKEN=\n'), '');
  assert.equal(parseOpenClawToken('OCTOKEN=   \n'), '');
  // The redaction placeholder must never be mistaken for a credential.
  assert.equal(parseOpenClawToken('OCTOKEN=__OPENCLAW_REDACTED__\n'), '');
  // The state line must not be read as a token line, in either order.
  assert.equal(parseOpenClawToken('OCTOKEN_AUTH=unset\nOCTOKEN=\n'), '');
  assert.equal(parseOpenClawToken('OCTOKEN_AUTH=configured\nOCTOKEN=tok\n'), 'tok');
});

test('parseOpenClawTokenAuth separates "no token configured" from "could not read"', () => {
  // The gateway parsed its config and carries no credential at all. The caller
  // DESTROYS state on this verdict (it retracts its own seed), so it must only
  // be returned for the one input that proves it.
  assert.equal(parseOpenClawTokenAuth('OCTOKEN_AUTH=unset\nOCTOKEN=\n'), 'unset');
  assert.equal(parseOpenClawTokenAuth('OCTOKEN_AUTH=configured\nOCTOKEN=tok\n'), 'configured');

  // Everything else is "we do not know" — a file we could not open, a missing
  // python3, a truncated response, an exec error. Guessing `unset` here would
  // throw away a credential that may well have been valid.
  assert.equal(parseOpenClawTokenAuth('OCTOKEN_AUTH=unknown\nOCTOKEN=\n'), 'unknown');
  assert.equal(parseOpenClawTokenAuth(''), 'unknown');
  assert.equal(parseOpenClawTokenAuth(null), 'unknown');
  assert.equal(parseOpenClawTokenAuth('OCTOKEN_AUTH=\n'), 'unknown');
  assert.equal(parseOpenClawTokenAuth('OCTOKEN_AUTH=banana\n'), 'unknown');
  assert.equal(parseOpenClawTokenAuth('warning: motd\nOCTOKEN=\n'), 'unknown');
});

test('the storage key matches the one the Control UI actually reads', () => {
  // Measured by driving the UI's own login form and diffing storage, not by
  // reading its source. A wrong prefix here is a silent no-op.
  assert.equal(OPENCLAW_TOKEN_KEY_PREFIX, 'openclaw.control.token.v1:');
  const gw = 'ws://localhost:3030/api/agents/webui-proxy/m2/abc/18789';
  assert.equal(openClawTokenStorageKey(gw), `openclaw.control.token.v1:${gw}`);
});

test('the seed-marker key is ours, and shares the UI key\'s gateway suffix', () => {
  // The marker is what makes retraction safe: it records the value WE wrote, so
  // the retract path can tell our seed from a secret the operator pasted. It
  // must be a different key from the UI's, and it must be keyed the same way so
  // one gateway's marker can never be compared against another's secret.
  assert.equal(OPENCLAW_SEED_MARK_PREFIX, 'openclaw.control.monitorSeed.v1:');
  assert.notEqual(OPENCLAW_SEED_MARK_PREFIX, OPENCLAW_TOKEN_KEY_PREFIX);
  const gw = 'ws://localhost:3030/api/agents/webui-proxy/m2/abc/18789';
  assert.equal(openClawSeedMarkKey(gw), `openclaw.control.monitorSeed.v1:${gw}`);
  assert.ok(openClawSeedMarkKey(gw).endsWith(gw), 'same gateway suffix as the token key');
});

test('the remote command reads the config file, with no fallback that can lie', () => {
  // The config is JSON and the value is plaintext in it (the gateway's own
  // `doctor --json` warns about that). python3 does the read.
  assert.match(OPENCLAW_TOKEN_CMD, /\.openclaw\/openclaw\.json/);
  assert.match(OPENCLAW_TOKEN_CMD, /python3/);
  assert.match(OPENCLAW_TOKEN_CMD, /gateway/);
  assert.match(OPENCLAW_TOKEN_CMD, /OCTOKEN=%s/);
  // Both lines are always printed, on every path — a missing AUTH line would
  // silently downgrade "no token configured" to "unknown" and lose the retract.
  assert.match(OPENCLAW_TOKEN_CMD, /OCTOKEN_AUTH=unset/);
  assert.match(OPENCLAW_TOKEN_CMD, /OCTOKEN_AUTH=configured/);
  assert.match(OPENCLAW_TOKEN_CMD, /OCTOKEN_AUTH=unknown/);

  // A previous draft built this by .join('; ') over an array of fragments,
  // which produced `if [ -f "$F" ]; then; T=…` — a shell syntax error, so the
  // command never ran and the token silently read as empty. Pin the shape.
  assert.doesNotMatch(OPENCLAW_TOKEN_CMD, /then\s*;/);

  // There must be NO awk fallback. The obvious one ("the first `"token"` after
  // `"gateway"`") matches `"mode": "token"` and returns the literal string
  // `token` — a wrong secret, which fails as token_mismatch and hides the real
  // cause. Verified by running it; see the module doc comment.
  assert.doesNotMatch(OPENCLAW_TOKEN_CMD, /\bawk\b/);

  // The python payload sits inside a double-quoted shell string, so a `$` in it
  // would be expanded by the shell before python ever sees it.
  const py = OPENCLAW_TOKEN_CMD.slice(OPENCLAW_TOKEN_CMD.indexOf('python3 -c "'), OPENCLAW_TOKEN_CMD.indexOf('" "$F"'));
  assert.doesNotMatch(py, /\$/, 'no shell-expandable $ inside the python payload');
});

test('readOpenClawGatewayToken runs the command and returns the token and its state', async () => {
  clearOpenClawTokenCache();
  scriptRemote(() => ({ stdout: 'OCTOKEN_AUTH=configured\nOCTOKEN=309a91d7361b19449fc893c7dd18f4c645f3f09bbea92f99\n' }));

  const r = await readOpenClawGatewayToken({ host: 'h' }, 'conn-1');
  assert.equal(r.token, '309a91d7361b19449fc893c7dd18f4c645f3f09bbea92f99');
  assert.equal(r.auth, 'configured');

  assert.equal(globalThis.__calls.length, 1);
  assert.equal(globalThis.__calls[0].cmd, OPENCLAW_TOKEN_CMD);
  // Pooled and bounded: a hung remote must not hold the document request open.
  assert.equal(globalThis.__calls[0].opts.pool, true);
  assert.ok(globalThis.__calls[0].opts.timeoutMs > 0);
});

test('a gateway with no credential configured reports unset, not an empty token', async () => {
  clearOpenClawTokenCache();
  scriptRemote(() => ({ stdout: 'OCTOKEN_AUTH=unset\nOCTOKEN=\n' }));
  const r = await readOpenClawGatewayToken({}, 'conn-unset');
  assert.equal(r.token, '');
  assert.equal(r.auth, 'unset');
});

test('readOpenClawGatewayToken memoises briefly, so a reload is not another exec', async () => {
  clearOpenClawTokenCache();
  scriptRemote(() => ({ stdout: 'OCTOKEN_AUTH=configured\nOCTOKEN=tok\n' }));

  await readOpenClawGatewayToken({}, 'conn-2');
  await readOpenClawGatewayToken({}, 'conn-2');
  await readOpenClawGatewayToken({}, 'conn-2');
  assert.equal(globalThis.__calls.length, 1, 'three reads inside the TTL must cost one exec');

  // The TTL is short on purpose: if the operator regenerates the token, a stale
  // value self-corrects rather than being injected forever.
  await readOpenClawGatewayToken({}, 'conn-2', { ttlMs: 0 });
  assert.equal(globalThis.__calls.length, 2, 'an expired entry must re-read');

  // Cache is per connection — one gateway's secret must not answer for another.
  await readOpenClawGatewayToken({}, 'conn-3', { ttlMs: 0 });
  assert.equal(globalThis.__calls.length, 3);
});

test('a gateway we cannot read yields no token, not a broken page', async () => {
  clearOpenClawTokenCache();
  // Exec throws (host down, no SSH, timeout) …
  scriptRemote(() => { throw new Error('ECONNREFUSED'); });
  const r = await readOpenClawGatewayToken({}, 'conn-4');
  assert.equal(r.token, '');
  // … and the state must be `unknown`, NOT `unset`: an unreachable host must
  // never make the proxy retract a seed it cannot prove is stale.
  assert.equal(r.auth, 'unknown');
  // The failure is cached too, so a down host does not cost an exec per
  // request while the user stares at the prompt.
  await readOpenClawGatewayToken({}, 'conn-4');
  assert.equal(globalThis.__calls.length, 1);

  // A file with no token (never configured) is also just ''.
  clearOpenClawTokenCache();
  scriptRemote(() => ({ stdout: 'OCTOKEN_AUTH=unset\nOCTOKEN=\n' }));
  assert.equal((await readOpenClawGatewayToken({}, 'conn-5')).token, '');
});

// ── proxy wiring ───────────────────────────────────────────────────────────
// Source-level, like zeroclaw-proxy-basename.test.mjs: the proxy route cannot
// be imported in a unit test (Next request context + mongoose).

const proxy = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');

function section(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? src.indexOf(end, from) : src.length;
  return src.slice(from, to < 0 ? src.length : to);
}

test('the token is read only when serving OpenClaw, and only for documents', () => {
  // The read costs a remote exec, and only this dashboard consumes a seeded
  // secret. Gating on agentId also keeps the read off the asset path entirely.
  const guard = section(proxy, "if (agentId === 'openclaw') {", 'html = rewriteHtml(');
  assert.match(guard, /readOpenClawGatewayToken\(sshConfig, connectionId\)/);
  // Declared empty first, so every other agent takes the '' path without a read.
  const declAt = proxy.indexOf("let openclawToken = '';");
  assert.ok(declAt >= 0, 'the token must be declared');
  assert.ok(declAt < proxy.indexOf("if (agentId === 'openclaw') {"), 'declared before the guard');
  // The state has to be declared alongside it, or a non-OpenClaw page would
  // inject `undefined` and the retract branch could fire on a stray value.
  const authAt = proxy.indexOf("let openclawAuth = '';");
  assert.ok(authAt > declAt && authAt < proxy.indexOf("if (agentId === 'openclaw') {"),
    'the auth state must be declared (empty) before the guard');
  // It must be awaited inside the text/html branch, i.e. not on every asset.
  assert.match(proxy, /if \(contentType\.includes\('text\/html'\)\) \{[\s\S]{0,600}agentId === 'openclaw'/);
});

test('rewriteHtml takes the token and its state as trailing, defaulted parameters', () => {
  // Defaulted so the legacy call shape (and any caller added later) still works.
  assert.match(
    proxy,
    /function rewriteHtml\(html, proxyBase, currentPath, port, connectionId, agentId = 'nanobot', extraProxyQuery = '', openclawToken = '', openclawAuth = ''\)/
  );
  assert.match(proxy, /extraProxyQuery, openclawToken, openclawAuth\);/);
  // Both values come from the ONE read; a second exec per document would double
  // the latency of every tab load for no extra information.
  assert.match(proxy, /\(\{ token: openclawToken, auth: openclawAuth \} = await readOpenClawGatewayToken/);
});

test('the seed writes sessionStorage under the UI\'s own key', () => {
  const injected = section(proxy, 'var OPENCLAW_TOKEN =', 'function proxyWsUrl(p) {');

  // sessionStorage, explicitly — this is the store the UI reads. Writing
  // localStorage instead was tried first and was completely inert.
  assert.match(injected, /sessionStorage\.setItem\(/);
  assert.doesNotMatch(injected, /localStorage/);

  // The gateway URL is only knowable in the browser, so the script must
  // concatenate the prefix with a host-derived URL rather than hard-coding one.
  assert.match(injected, /OPENCLAW_TOKEN_KEY_PREFIX/);
  assert.match(injected, /location\.host/);
  assert.match(injected, /location\.protocol === 'https:' \? 'wss' : 'ws'/);

  // Guarded: an empty token must write NOTHING. Seeding '' would turn "no
  // secret" into "the wrong secret" and change the failure from the honest
  // prompt to a token_mismatch.
  assert.match(injected, /if \(OPENCLAW_TOKEN\) \{/);
});

// ── the seed block, EXECUTED ───────────────────────────────────────────────
// The block's branching (seed / retract / leave alone) is the part that broke,
// and a regex cannot tell a correct branch from a plausible-looking one. So the
// block is lifted out of the route, its `${…}` placeholders resolved, and run
// against a fake sessionStorage. Same spirit as the rest of this file: pin the
// behaviour, not the source.

const ASSET_PREFIX = '/api/agents/webui-proxy/m2/abc/18789';
const GW = `ws://localhost:3030${ASSET_PREFIX}`;
const TOKEN_KEY = `${OPENCLAW_TOKEN_KEY_PREFIX}${GW}`;
const TOKEN_KEY_SLASH = `${TOKEN_KEY}/`;
const MARK_KEY = `${OPENCLAW_SEED_MARK_PREFIX}${GW}`;
const MARK_KEY_SLASH = `${MARK_KEY}/`;

function runSeed({ token = '', auth = 'unknown', store = new Map() } = {}) {
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const code = section(proxy, 'var OPENCLAW_TOKEN =', 'function proxyWsUrl(p) {')
    .replace(/^.*var OPENCLAW_TOKEN = .*$/m, `var OPENCLAW_TOKEN = ${JSON.stringify(token)};`)
    .replace(/^.*var OPENCLAW_AUTH = .*$/m, `var OPENCLAW_AUTH = ${JSON.stringify(auth)};`)
    .replace(/\$\{JSON\.stringify\(OPENCLAW_TOKEN_KEY_PREFIX\)\}/g, JSON.stringify(OPENCLAW_TOKEN_KEY_PREFIX))
    .replace(/\$\{JSON\.stringify\(OPENCLAW_SEED_MARK_PREFIX\)\}/g, JSON.stringify(OPENCLAW_SEED_MARK_PREFIX));
  assert.doesNotMatch(code, /\$\{/, 'every placeholder must be resolved before running the block');
  vm.runInNewContext(code, {
    location: { protocol: 'http:', host: 'localhost:3030' },
    sessionStorage,
    ASSET_PREFIX,
  });
  return store;
}

test('the seed writes both spellings of the UI key, plus our own marker', () => {
  const store = runSeed({ token: 'TOK', auth: 'configured' });
  // The UI normalises the page path by dropping a trailing slash, so the key it
  // computes can differ from ours by exactly that. Seed both; a miss is silent.
  assert.equal(store.get(TOKEN_KEY), 'TOK');
  assert.equal(store.get(TOKEN_KEY_SLASH), 'TOK');
  // The marker is what lets a later load retract this seed and nothing else.
  assert.equal(store.get(MARK_KEY), 'TOK');
  assert.equal(store.get(MARK_KEY_SLASH), 'TOK');
});

test('an unreadable gateway leaves the tab exactly as it was', () => {
  // `unknown` means "we could not read the config", NOT "there is no token".
  // Touching the tab on that verdict would discard a credential that may well
  // have been valid.
  const store = runSeed({ token: '', auth: 'unknown', store: new Map([['untouched', 'yes']]) });
  assert.equal(store.size, 1);
  assert.equal(store.get('untouched'), 'yes');
});

test('a gateway with no credential retracts OUR seed, and only ours', () => {
  // The reported bug, end to end: a secret seeded while the gateway still had a
  // token survives in the tab, the Control UI auto-fills its "Gateway secret"
  // field from it on every load, and after a fresh install (no gateway
  // credential at all) Connect fails as `token_mismatch` — an error that names
  // the wrong cause and sends the user looking for a token that does not exist.
  const seeded = new Map([
    [TOKEN_KEY, 'SEEDED-BEFORE-REINSTALL'],
    [MARK_KEY, 'SEEDED-BEFORE-REINSTALL'],
    [TOKEN_KEY_SLASH, 'SEEDED-BEFORE-REINSTALL'],
    [MARK_KEY_SLASH, 'SEEDED-BEFORE-REINSTALL'],
  ]);
  assert.equal(runSeed({ token: '', auth: 'unset', store: seeded }).size, 0,
    'our own dead seed must be retracted');

  // A secret the OPERATOR pasted over our seed is not ours to discard: the
  // marker still holds the value we wrote, the token key holds theirs, and they
  // disagree — the one case we can PROVE is not our seed.
  const pasted = new Map([[TOKEN_KEY, 'PASTED-BY-HAND'], [MARK_KEY, 'WHAT-WE-SEEDED']]);
  const after = runSeed({ token: '', auth: 'unset', store: pasted });
  assert.equal(after.get(TOKEN_KEY), 'PASTED-BY-HAND');
  assert.equal(after.get(MARK_KEY), 'WHAT-WE-SEEDED');

  // A key with NO marker is retracted too — that is the shape a seed written by
  // the version before markers existed leaves behind, i.e. exactly the tab that
  // reported this bug. With nothing configured on the host it cannot
  // authenticate, so keeping it only reproduces the phantom mismatch.
  const legacy = new Map([[TOKEN_KEY, 'SEEDED-BY-AN-OLDER-BUILD']]);
  assert.equal(runSeed({ token: '', auth: 'unset', store: legacy }).size, 0,
    'a marker-less leftover must be retracted as well');

  // Nothing stored at all is a no-op, and the marker alone is left alone (we
  // cannot prove ownership of a key that is not there).
  assert.equal(runSeed({ token: '', auth: 'unset', store: new Map() }).size, 0);
  const markOnly = new Map([[MARK_KEY, 'WHAT-WE-SEEDED']]);
  assert.equal(runSeed({ token: '', auth: 'unset', store: markOnly }).size, 1);

  // And the normal path — a gateway WITH a credential — overwrites whatever was
  // there with the real value rather than retracting anything.
  const stale = new Map([[TOKEN_KEY, 'STALE'], [MARK_KEY, 'STALE']]);
  const refreshed = runSeed({ token: 'FRESH', auth: 'configured', store: stale });
  assert.equal(refreshed.get(TOKEN_KEY), 'FRESH');
  assert.equal(refreshed.get(MARK_KEY), 'FRESH');
});

test('the seed runs inside the injected head script, before the bundle boots', () => {
  const injected = section(proxy, 'const scriptTag = `', '</script>');
  const seedAt = injected.indexOf('var OPENCLAW_TOKEN =');
  assert.ok(seedAt >= 0, 'the seed must live in the injected script');
  // Anything that throws during the seed must not take the page down with it.
  assert.match(injected, /catch \(e\) \{\}/);
  // And it must precede the WebSocket patch that the app's connect frame goes
  // through, so the secret is in place by the time the UI reads it.
  const wsPatchAt = injected.indexOf('window.WebSocket = function ProxiedWebSocket');
  assert.ok(wsPatchAt < 0 || seedAt < wsPatchAt, 'seed must precede the WebSocket patch');
});

test('the injected patch rewrites root-absolute url() values in style attributes', () => {
  const injected = section(proxy, 'var CSS_URL_RE =', '  // Same rewrite for markup');
  // OpenClaw/Lit puts provider icons in a CSS custom property on a style
  // attribute, not in src/href markup. The old patch missed style entirely and
  // caused 39 provider-icon 404s through the proxy while raw served 39/39.
  assert.match(injected, /var CSS_URL_RE = new RegExp\(/);
  assert.match(injected, /function fixCssUrls\(css\)/);
  assert.match(proxy, /if \(name === 'style' && typeof value === 'string'\)/);
  assert.match(proxy, /value = fixCssUrls\(value\);/);

  // The regex must be constructor-built: a literal inside this template loses
  // its backslash-slash escapes and can break parsing of the entire injection.
  assert.doesNotMatch(injected, /\/url\\\\\(/);
  const fullInjected = section(proxy, 'const scriptTag = `', '</script>');
  const fixAt = fullInjected.indexOf('function fixCssUrls(css)');
  const setterAt = fullInjected.indexOf("name === 'style'");
  assert.ok(setterAt > fixAt, 'style setter must call a helper declared earlier');
});
