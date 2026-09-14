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
  parseOpenClawToken,
  openClawTokenStorageKey,
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
});

test('the storage key matches the one the Control UI actually reads', () => {
  // Measured by driving the UI's own login form and diffing storage, not by
  // reading its source. A wrong prefix here is a silent no-op.
  assert.equal(OPENCLAW_TOKEN_KEY_PREFIX, 'openclaw.control.token.v1:');
  const gw = 'ws://localhost:3030/api/agents/webui-proxy/m2/abc/18789';
  assert.equal(openClawTokenStorageKey(gw), `openclaw.control.token.v1:${gw}`);
});

test('the remote command reads the config file, with no fallback that can lie', () => {
  // The config is JSON and the value is plaintext in it (the gateway's own
  // `doctor --json` warns about that). python3 does the read.
  assert.match(OPENCLAW_TOKEN_CMD, /\.openclaw\/openclaw\.json/);
  assert.match(OPENCLAW_TOKEN_CMD, /python3/);
  assert.match(OPENCLAW_TOKEN_CMD, /gateway/);
  assert.match(OPENCLAW_TOKEN_CMD, /OCTOKEN=%s/);

  // A previous draft built this by .join('; ') over an array of fragments,
  // which produced `if [ -f "$F" ]; then; T=…` — a shell syntax error, so the
  // command never ran and the token silently read as empty. Pin the shape.
  assert.doesNotMatch(OPENCLAW_TOKEN_CMD, /then\s*;/);

  // There must be NO awk fallback. The obvious one ("the first `"token"` after
  // `"gateway"`") matches `"mode": "token"` and returns the literal string
  // `token` — a wrong secret, which fails as token_mismatch and hides the real
  // cause. Verified by running it; see the module doc comment.
  assert.doesNotMatch(OPENCLAW_TOKEN_CMD, /\bawk\b/);
});

test('readOpenClawGatewayToken runs the command and returns the parsed token', async () => {
  clearOpenClawTokenCache();
  scriptRemote(() => ({ stdout: 'OCTOKEN=309a91d7361b19449fc893c7dd18f4c645f3f09bbea92f99\n' }));

  const token = await readOpenClawGatewayToken({ host: 'h' }, 'conn-1');
  assert.equal(token, '309a91d7361b19449fc893c7dd18f4c645f3f09bbea92f99');

  assert.equal(globalThis.__calls.length, 1);
  assert.equal(globalThis.__calls[0].cmd, OPENCLAW_TOKEN_CMD);
  // Pooled and bounded: a hung remote must not hold the document request open.
  assert.equal(globalThis.__calls[0].opts.pool, true);
  assert.ok(globalThis.__calls[0].opts.timeoutMs > 0);
});

test('readOpenClawGatewayToken memoises briefly, so a reload is not another exec', async () => {
  clearOpenClawTokenCache();
  scriptRemote(() => ({ stdout: 'OCTOKEN=tok\n' }));

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
  assert.equal(await readOpenClawGatewayToken({}, 'conn-4'), '');
  // … and the failure is cached too, so a down host does not cost an exec per
  // request while the user stares at the prompt.
  await readOpenClawGatewayToken({}, 'conn-4');
  assert.equal(globalThis.__calls.length, 1);

  // A file with no token (never configured) is also just ''.
  clearOpenClawTokenCache();
  scriptRemote(() => ({ stdout: 'OCTOKEN=\n' }));
  assert.equal(await readOpenClawGatewayToken({}, 'conn-5'), '');
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
  // It must be awaited inside the text/html branch, i.e. not on every asset.
  assert.match(proxy, /if \(contentType\.includes\('text\/html'\)\) \{[\s\S]{0,600}agentId === 'openclaw'/);
});

test('rewriteHtml takes the token as a trailing, defaulted parameter', () => {
  // Defaulted so the legacy call shape (and any caller added later) still works.
  assert.match(
    proxy,
    /function rewriteHtml\(html, proxyBase, currentPath, port, connectionId, agentId = 'nanobot', extraProxyQuery = '', openclawToken = ''\)/
  );
  assert.match(proxy, /extraProxyQuery, openclawToken\);/);
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

test('the seed covers both spellings of the gateway URL', () => {
  const injected = section(proxy, 'var OPENCLAW_TOKEN =', 'function proxyWsUrl(p) {');
  // The UI normalises the page path by dropping a trailing slash, so the key it
  // computes can differ from ours by exactly that. Seed both; a miss is silent.
  assert.match(injected, /sessionStorage\.setItem\([\s\S]*?OPENCLAW_GW, OPENCLAW_TOKEN\);/);
  assert.match(injected, /sessionStorage\.setItem\([\s\S]*?OPENCLAW_GW \+ '\/', OPENCLAW_TOKEN\);/);
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
