import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Cross-agent parity for the Web UI contract.
 *
 * `AIAgentsApp` renders ONE Web UI card for whichever agent is selected and
 * reads the same fields and calls the same `webui-ctl` ops for all of them. The
 * four routes are separate files with no shared type, so nothing but this test
 * stops one of them from drifting:
 *
 *   • a route that renames or omits a `details` field makes the card read
 *     `undefined` — the Start button loses its port, or `webUIActive` is always
 *     falsy so the button never flips;
 *   • a route whose op allowlist drops `relay-start` silently downgrades the
 *     user's own machine to the central proxy, with no error anywhere.
 *
 * Neither shows up as a crash. Both show up as a UI that quietly does the wrong
 * thing, which is why the contract is pinned here rather than left to review.
 */

const AGENTS = ['hermes', 'nanobot', 'zeroclaw', 'openclaw'];

/** The `details` payload fields the Web UI card consumes. */
const CONTRACT_FIELDS = ['webUIPort', 'webUIActive', 'webUIBind', 'webUILoopback', 'webUIBootstrapPath'];

/** Tokens matching /webUI[A-Za-z]+/ that are imports/helpers, not payload fields. */
const NON_FIELD_TOKENS = new Set(['webUIProbeShell']);

/** The `webui-ctl` ops every route must accept. */
const CONTRACT_OPS = ['start', 'stop', 'restart', 'status', 'relay-start'];

const sources = Object.fromEntries(
  AGENTS.map((a) => [a, readFileSync(`src/app/api/agents/${a}/route.js`, 'utf8')])
);

function webuiFields(src) {
  const tokens = new Set([...src.matchAll(/\bwebUI[A-Za-z]+\b/g)].map((m) => m[1] || m[0]));
  for (const t of NON_FIELD_TOKENS) tokens.delete(t);
  return tokens;
}

function webuiCtlOps(src) {
  const block = src.slice(src.indexOf("if (action === 'webui-ctl')"));
  assert.ok(block.length > 200, 'webui-ctl block not found');
  const m = /const op = \[([^\]]*)\]\.includes\(config\.op\)/.exec(block);
  assert.ok(m, 'webui-ctl must gate config.op through an allowlist');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

test('every agent route exposes the same Web UI details fields', () => {
  for (const id of AGENTS) {
    const fields = webuiFields(sources[id]);
    for (const f of CONTRACT_FIELDS) {
      assert.ok(fields.has(f), `${id}: details is missing ${f}`);
    }
    // No extras either — an agent-only field is a field the card cannot rely on
    // for the next agent, and it signals the contract has started to fork.
    const extra = [...fields].filter((f) => !CONTRACT_FIELDS.includes(f));
    assert.deepEqual(extra, [], `${id}: details exposes fields outside the contract: ${extra.join(', ')}`);
  }
});

test('every agent route accepts the same webui-ctl ops', () => {
  for (const id of AGENTS) {
    const ops = webuiCtlOps(sources[id]);
    assert.deepEqual(ops, CONTRACT_OPS, `${id}: webui-ctl op allowlist drifted`);
  }
});

test('every agent route takes the relay port from the relay ack', () => {
  // The relay binds the port it can actually get and reports the real one via
  // `webui:ready`. A route that returned its requested port instead would hand
  // the browser a port owned by some other connection's gateway — or by nothing
  // at all. Both flavours satisfy this: hermes/nanobot run the handshake inline,
  // zeroclaw/openclaw delegate to the shared helper.
  for (const id of AGENTS) {
    const block = sources[id].slice(sources[id].indexOf("if (action === 'webui-ctl')"));
    const branch = block.slice(block.indexOf("if (op === 'relay-start')"));
    assert.ok(branch.length > 50, `${id}: relay-start branch missing`);

    const inline = /__waitForWebuiForward/.test(branch) && /Number\(ack\?\.port\)/.test(branch);
    const delegated = /startWebuiRelayTunnel\(/.test(branch);
    assert.ok(inline || delegated, `${id}: relay-start must take the port from the relay ack, not from the request`);
  }
});

test('the response tells the client whether the port was confirmed', () => {
  // `portConfirmed` is how the UI distinguishes "the relay told us the port"
  // from "we asked for one and hoped". For the delegating routes it lives in the
  // shared helper, so check the file that actually writes it.
  const helper = readFileSync('src/app/api/agents/_webui-relay.js', 'utf8');
  for (const id of AGENTS) {
    const src = id === 'zeroclaw' || id === 'openclaw' ? helper : sources[id];
    assert.match(src, /portConfirmed/, `${id}: nothing reports portConfirmed`);
  }
});

test('the two new routes delegate to the shared relay helper', () => {
  // hermes/nanobot keep their inline copies on purpose (heavily exercised, and
  // migrating them is a separate change). The new routes must not add a third
  // and fourth copy of ordering-sensitive handshake code.
  for (const id of ['zeroclaw', 'openclaw']) {
    assert.match(sources[id], /from '\.\.\/_webui-relay'/, `${id}: must import the shared helper`);
    assert.match(sources[id], /startWebuiRelayTunnel\(\{/, `${id}: relay-start must use the shared tunnel helper`);
    assert.match(sources[id], /webUIProbeShell\(/, `${id}: probe must use the shared shell fragment`);
    assert.match(sources[id], /parseWebUIProbe\(/, `${id}: probe must use the shared parser`);
  }
});

test('the shared helper exports the contract the routes import', () => {
  const helper = readFileSync('src/app/api/agents/_webui-relay.js', 'utf8');
  for (const name of ['webUIProbeShell', 'parseWebUIProbe', 'startWebuiRelayTunnel']) {
    assert.match(helper, new RegExp(`export (?:async )?function ${name}\\b`), `helper must export ${name}`);
  }
  // The ack waiter has to be registered BEFORE the forward is sent, or a fast
  // relay answers into the void and the caller waits out the full timeout.
  // Match the CALLS (with parens) — the bridge-availability guard at the top of
  // the function references the send hook earlier in the file, so a bare name
  // search would compare the guard against the waiter and invert the result.
  const waitAt = helper.indexOf('__waitForWebuiForward(');
  const sendAt = helper.indexOf('__sendToRelayForUserAny(');
  assert.ok(waitAt >= 0 && sendAt >= 0, 'helper must use both relay bridge hooks');
  assert.ok(waitAt < sendAt, 'the ack waiter must be registered before sending the forward');
});
