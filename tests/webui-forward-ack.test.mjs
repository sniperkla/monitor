import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The `webui:forward` ack contract between Local Relay and the monitor server.
 *
 * The relay binds a loopback listener, tunnels it over SSH to the agent's Web
 * UI, verifies the full chain, and only then reports the port it actually
 * bound. The server waits for that report before answering the browser, because
 * answering with a guessed port sends the user to a dead address.
 *
 * The bug these tests lock out: when the relay *failed*, it only logged the
 * error locally and sent nothing. The server therefore could not tell
 * "no relay is connected" from "the relay is connected and the tunnel failed",
 * so it waited out its full timeout and then told the user to check that Local
 * Relay was running — while it was running fine. Two distinct faults were
 * reported as one wrong one.
 *
 * So there are two failure channels and they must stay distinguishable:
 *   webui:ready  → { port }             (success)
 *   webui:fail   → { error }            (relay is up, tunnel failed)  → 502
 *   (timeout)    → { timedOut: true }   (no relay / relay too old)    → 504
 */

const relay = readFileSync('public/local-relay.js', 'utf8');
const server = readFileSync('server.js', 'utf8');
const nanobot = readFileSync('src/app/api/agents/nanobot/route.js', 'utf8');
const hermes = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');

function section(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? src.indexOf(end, from) : src.length;
  return src.slice(from, to < 0 ? src.length : to);
}

/** The relay-start branch of a webui-ctl handler. */

// ── relay side ──────────────────────────────────────────────────────────────

test('a failed webui:forward is reported to the server, not just logged', () => {
  const reporter = section(relay, 'function reportWebuiFailure', 'async function handleWebuiForward');
  // The whole point: the server learns the reason.
  assert.match(reporter, /type: 'webui:fail'/,
    'the relay must send a webui:fail message when the tunnel cannot be opened');
  assert.match(reporter, /forwardId/, 'the failure must carry the id the server is waiting on');
  assert.match(reporter, /error: message/, 'the failure must carry the reason');
  // Still logs locally — the relay's own log is the only place with full detail.
  assert.match(reporter, /console\.error/);
  // Best-effort: a dead socket must not mask the original error.
  assert.match(reporter, /readyState === 1/);
  assert.match(reporter, /catch \(_\)/);
});

test('the webui:forward handler reports failures through that helper', () => {
  assert.match(relay, /case 'webui:forward':\s*handleWebuiForward\(msg\)\.catch\(err => reportWebuiFailure\(msg, err\)\);/,
    'the dispatch must route a rejected handleWebuiForward into the reporter');
  // Regression guard: this was the original bug — log and drop.
  assert.doesNotMatch(relay, /handleWebuiForward\(msg\)\.catch\(err => console\.error/,
    'a bare console.error here loses the reason and strands the server on its timeout');
});

test('a failure with no forwardId is not reported', () => {
  const reporter = section(relay, 'function reportWebuiFailure', 'async function handleWebuiForward');
  // `handleWebuiForward` throws for a missing forwardId too, and there is
  // nothing to correlate such a failure with.
  assert.match(reporter, /if \(!forwardId\) return;/);
});

test('reportWebuiFailure actually sends webui:fail — executed, not grepped', () => {
  // The source-level assertions above pin the contract; this runs the real
  // function text out of the shipped relay so the behaviour is verified too.
  const src = section(relay, 'function reportWebuiFailure', 'async function handleWebuiForward');
  const build = (activeWs) =>
    new Function('activeWs', 'console', `${src}; return reportWebuiFailure;`)(
      activeWs,
      { error() {} },
    );

  const sent = [];
  const live = build({ readyState: 1, send: (s) => sent.push(s) });

  live({ forwardId: 'conn-1-8765' }, new Error('All configured authentication methods failed'));
  assert.equal(sent.length, 1, 'a connected relay must report the failure');
  assert.deepEqual(JSON.parse(sent[0]), {
    type: 'webui:fail',
    forwardId: 'conn-1-8765',
    error: 'All configured authentication methods failed',
  }, 'the server needs the id it is waiting on plus the reason');

  // Nothing to correlate → nothing sent.
  sent.length = 0;
  live({}, new Error('webui:forward missing fields'));
  assert.equal(sent.length, 0);

  // A socket that dies mid-send must not mask the original error.
  sent.length = 0;
  const dead = build({ readyState: 3, send: () => { throw new Error('socket closed'); } });
  assert.doesNotThrow(() => dead({ forwardId: 'x' }, new Error('boom')));
  const throwing = build({ readyState: 1, send: () => { throw new Error('socket closed'); } });
  assert.doesNotThrow(() => throwing({ forwardId: 'x' }, new Error('boom')));
});

test('reportWebuiFailure still logs locally', () => {
  // The relay's own log is the only place with the full detail, and it is what
  // the user is asked to check.
  const src = section(relay, 'function reportWebuiFailure', 'async function handleWebuiForward');
  const lines = [];
  const fn = new Function('activeWs', 'console', `${src}; return reportWebuiFailure;`)(
    { readyState: 1, send() {} },
    { error: (m) => lines.push(m) },
  );
  fn({ forwardId: 'a' }, new Error('ssh handshake failed'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /ssh handshake failed/);
});

// ── server side ─────────────────────────────────────────────────────────────

test('the waiter carries a reason, not just a port', () => {
  const waiter = section(server, 'global.__waitForWebuiForward', '// Idle timeout');
  // A bare port could not express "the relay said why it failed".
  assert.match(waiter, /resolve\(result\)/, 'the waiter must resolve a result object');
  assert.match(waiter, /port: null, error: null, timedOut: true/,
    'a timeout must be distinguishable from a reported failure');
});

test('the server resolves the waiter on webui:fail with the relay’s reason', () => {
  const branch = section(server, "if (msg.type === 'webui:fail')", "if (msg.type === 'init')");
  assert.match(branch, /__webuiForwardWaiters/, 'the failure must find the pending waiter');
  // Accepts both `error,` (shorthand) and `error: error`.
  assert.match(branch, /waiter\.resolve\(\{ port: null, error[:\s,]/, 'the reason must reach the route');
  assert.match(branch, /timedOut: false/, 'a reported failure is not a timeout');
  assert.match(branch, /port: null/, 'a failed forward has no port');
  // Untrusted input from the relay — must not be able to bloat a response.
  assert.match(branch, /slice\(0, 300\)/, 'the relay-supplied message must be length-capped');
  assert.match(branch, /msg\.error \|\| 'Local Relay could not open the Web UI tunnel'|typeof msg\.error === 'string'/,
    'a fail with no message still needs a usable fallback');
});

test('webui:ready still resolves a port with no error', () => {
  const branch = section(server, "if (msg.type === 'webui:ready')", "if (msg.type === 'webui:fail')");
  assert.match(branch, /waiter\.resolve\(\{ port, error: null, timedOut: false \}\)/);
});

// ── route side: the two faults must not be conflated ────────────────────────

for (const [name, src, noun] of [
  ['nanobot', nanobot, 'gateway'],
  ['hermes', hermes, 'dashboard'],
]) {
  test(`${name}: a relay-reported failure answers 502 and quotes the relay`, () => {
    const branch = section(src, 'if (!localPort) {', 'Direct relay requested');
    assert.match(branch, /if \(ack\?\.error\)/, 'the route must branch on the relay-reported reason');
    assert.match(branch, /status: 502/,
      'a connected relay that failed the tunnel is a bad gateway, not a timeout');
    assert.match(branch, /Local Relay could not open the Web UI tunnel: \$\{ack\.error\}/,
      'the user must see the relay’s own words, not a generic guess');
    assert.match(branch, /log\.push\(`✗ \[webui\] Local Relay could not open the tunnel: \$\{ack\.error\}`\)/,
      'the reason must also land in the returned log');
  });

  test(`${name}: a genuine timeout still answers 504 with the relay-is-down advice`, () => {
    const branch = section(src, 'if (!localPort) {', 'Direct relay requested');
    assert.match(branch, /status: 504/,
      'no answer at all is still a timeout, and that advice is the correct one');
    assert.match(branch, /Local Relay did not confirm the Web UI tunnel\. Check that Local Relay is running/,
      'the pre-existing timeout text must survive');
    assert.match(branch, /never confirmed the tunnel \(timed out\)/);
  });

  test(`${name}: reads the port from the ack object and confirms it`, () => {
    assert.match(src, /const ack = await ackPromise;/);
    assert.match(src, /const localPort = Number\(ack\?\.port\) \|\| 0;/,
      'the waiter no longer resolves a bare port');
    assert.match(src, /portConfirmed: !!localPort,/,
      'portConfirmed must reflect the port actually resolved');
    // Regression guard: the old shape silently yields NaN here.
    assert.doesNotMatch(src, /ackedPort/,
      'the removed bare-port contract must not linger');
  });

  test(`${name}: still fails loudly instead of guessing a port`, () => {
    const branch = section(src, 'if (!localPort) {', 'Direct relay requested');
    assert.match(branch, /success: false/, 'a guessed port used to leave the tab spinning');
    assert.match(branch, /portConfirmed: false/);
    assert.match(section(src, "op === 'relay-start'", 'const ack = await ackPromise'),
      /__waitForWebuiForward\(forwardId, 20000\)/,
      'the waiter must be registered before the forward is sent');
  });

  test(`${name}: the success path reports the acked port as confirmed`, () => {
    // Asserted against the whole file: these two lines are unique per route, and
    // slicing is fragile here because the success return follows the failure
    // block rather than preceding it.
    assert.match(src, /success: true, active: true, relay: true, localPort,/);
    assert.match(src, /portConfirmed: !!localPort,/);
  });
}

test('the two routes agree on the contract', () => {
  // Deliberately NOT an equality check on the two branches: they legitimately
  // differ (nanobot forwards a bootstrap secret, hermes does not; different
  // requested ports and nouns). What must agree is the failure handling, and
  // the per-route cases above already pin that down for both.
  for (const src of [nanobot, hermes]) {
    assert.match(src, /if \(ack\?\.error\)/);
    assert.match(src, /status: 502/);
    assert.match(src, /status: 504/);
  }
});
