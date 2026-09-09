import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Opening the agent Web UI must never strand the tab on "Opening Web UI…".
 *
 * The tab is claimed synchronously (popup-blocker requirement) and navigated
 * later, so every failure path between claim and navigation leaves a tab the
 * user is actively staring at. Historically none of them said anything:
 * `handleStartWebUI` only navigated inside `if (r?.active || r?.success)`, and
 * `openWebUIInTab` just closed the tab when the relay could not bind a tunnel.
 * A closed tab is feedback; an eternally spinning one is not.
 *
 * These lock in the four things that make the tab self-reporting:
 *   1. every failure path writes a reason INTO the tab,
 *   2. a watchdog catches a navigation that never committed,
 *   3. the same-origin server proxy is always offered as the way out,
 *   4. the injected HTML carries no backtick (it lives in a template literal).
 */

const app = readFileSync('src/apps/AIAgentsApp.js', 'utf8');
const nanobot = readFileSync('src/app/api/agents/nanobot/route.js', 'utf8');
const hermes = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');

function section(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? src.indexOf(end, from) : src.length;
  return src.slice(from, to < 0 ? src.length : to);
}

const startHandler = section(app, 'const handleStartWebUI = async () => {', '// Keep the ref in sync');
const openHandler = section(app, 'const openWebUIInTab = async (', 'const act = async (label, fn)');
const tabHelpers = section(app, 'const WEBUI_TAB_CSS = [', 'const openBlankWebUITab');

test('a failed Start Web UI explains itself in the claimed tab', () => {
  // The `else` is what used to be missing: `r` is undefined when callAction
  // throws, so the whole navigation block was skipped in silence.
  assert.match(startHandler, /if \(r\?\.active \|\| r\?\.success\)/);
  assert.match(startHandler, /\} else \{/);
  assert.match(startHandler, /failWebUITab\(startTab, \{/);
  // Reads the real reason off the response instead of inventing one.
  assert.match(startHandler, /const reason = r\?\.error/);
});

test('a thrown Start Web UI also reports into the claimed tab', () => {
  const catchBlock = section(startHandler, '} catch (err) {', '} finally {');
  assert.match(catchBlock, /failWebUITab\(startTab, \{/);
  assert.match(catchBlock, /err\?\.message/);
});

test('a relay that cannot bind a tunnel explains itself instead of silently closing', () => {
  assert.match(openHandler, /failWebUITab\(tab, \{/);
  // The old behaviour was a bare tab.close() with no in-tab message.
  assert.doesNotMatch(openHandler, /tab\.close\(\); \} catch \{\}/);
  // The reason is carried through from the relay-start response.
  assert.match(openHandler, /relayFailure = rr\?\.error/);
});

test('a missing Local Relay tells the claimed tab, it does not just close it', () => {
  const guard = section(openHandler, 'if \(!relayConnectedRef\.current\)', 'const tab = preopenedTab');
  assert.match(guard, /failWebUITab\(preopenedTab, \{/);
  assert.match(guard, /Local Relay is required/);
});

test('the claimed tab watches ITSELF for a jump that never commits', () => {
  // The opener cannot detect this. Measured in Chrome: after the tab leaves,
  // reading tab.location.href throws; before it leaves, an about:blank popup
  // reports the OPENER's URL as its href (about:blank inherits the creator's
  // URL). Both "did it move?" checks are blind — so the tab must decide.
  assert.match(app, /const navigateWebUITab = \(tab, directUrl, proxyUrl/);
  assert.doesNotMatch(app, /armWebUIWatchdog/);
  const nw = section(app, 'const navigateWebUITab = \(tab, directUrl, proxyUrl', '// Open the Web UI through the monitor server');
  // Attempts the jump from inside the tab...
  assert.match(nw, /location\.replace\(direct\)/);
  // ...and if the document is STILL alive at the deadline, renders the card.
  assert.match(nw, /document\.getElementById\("wb-stage"\)/);
  assert.match(nw, /box\.innerHTML = /);
  // Wired after injection, so no inline handler has to survive HTML escaping.
  assert.match(nw, /getElementById\("wb-proxy"\)/);
  assert.match(nw, /location\.replace\(proxy\)/);
});

test('every direct navigation goes through the self-watching tab', () => {
  assert.match(openHandler, /navigateWebUITab\(tab, url, proxyUrl\)/);
});

test('mobile WebUI opening skips the impossible relay loopback', () => {
  // A phone runs no relay and its 127.0.0.1 is the phone. The mobile branch
  // must run before the direct-relay guard, decide synchronously (no await may
  // precede window.open or the popup blocker wins), and pick the route from
  // the loopback probe — the same rule as the desktop "Via server" button:
  //   • webUILoopback === false → direct http://<host>:<port> (public bind)
  //   • loopback / probe pending → same-origin proxy (the only way in)
  const mobile = section(openHandler, 'const isMobileBrowser =', '// Require Local Relay');
  assert.match(mobile, /navigator\.userAgent/);
  assert.match(mobile, /if \(isMobileBrowser\) \{/);
  // Proxy route (loopback bind or probe pending) still navigates the tab.
  assert.match(mobile, /tab\.location\.href = mobileUrl/);
  assert.match(mobile, /mobileUrl = proxyUrl/);
  // Public bind → direct to the target's host, never through the loopback proxy.
  assert.match(mobile, /webUILoopback === false/);
  assert.match(mobile, /http:\/\/\$\{conn\.host\}:\$\{webUIPort\(\)\}/);
  // Reads go through refs, not the render closure — details may have been
  // refreshed by loadDetails() between handleStartWebUI and this call.
  assert.match(mobile, /detailsRef\.current\?\.webUILoopback/);
  assert.match(mobile, /connectionsRef\.current\?\.find/);
  assert.ok(mobile.indexOf('tab.location.href = mobileUrl') < openHandler.indexOf('if (!relayConnectedRef.current)'),
    'mobile routing must precede the direct relay guard');
});

test('the open/start round trips have a hard client-side deadline', () => {
  // A hung server leg (e.g. execCommand's non-pooled SSH connect that fires
  // neither 'ready' nor 'error') used to leave the claimed tab on the spinner
  // forever, because the fallback card is only written once the await resolves.
  assert.match(app, /const WEBUI_OPEN_DEADLINE_MS = /);
  assert.match(app, /function withDeadline\(/);
  // The relay-start call in openWebUIInTab is wrapped.
  assert.match(openHandler, /withDeadline\(\s*callRef\.current\('webui-ctl'/);
  // A deadline on Start Web UI explains itself in the claimed tab.
  assert.match(startHandler, /withDeadline\(\s*callAction\('Start Web UI'/);
  assert.match(startHandler, /r\?\.deadline/);
  assert.match(startHandler, /failWebUITab\(startTab, \{/);
});

test('"Via server" is only offered for a loopback-bound Web UI on the target', () => {
  // The proxy dials 127.0.0.1:<port> ON the target over SSH — meaningless for a
  // UI already exposed on a public interface (and the desktop button is hidden
  // there, so mobile must not silently proxy either).
  assert.match(app, /details\?\.webUILoopback && \(/);
  for (const [name, src] of [['nanobot', nanobot], ['hermes', hermes]]) {
    assert.match(src, /webUILoopback/, `${name} must report webUILoopback`);
    assert.match(src, /webUIBind/, `${name} must report webUIBind`);
    assert.match(src, /ss -tln/, `${name} must probe the listen address`);
    assert.match(src, /netstat -tln/, `${name} must fall back to netstat`);
  }
});

test('failure cards always offer the same-origin server route', () => {
  // A phone runs no relay and its 127.0.0.1 is the phone, so the proxy is the
  // only route that can work there. Every card has to carry it.
  assert.match(app, /const webUIProxyUrl = \(\) => \{/);
  assert.match(startHandler, /proxyUrl: webUIProxyUrl\(\)/);
  assert.match(openHandler, /const proxyUrl = webUIProxyUrl\(\);/);
  assert.match(app, /const openWebUIViaServer = \(\) => \{/);
});

test('the server route is offered as a real button, not only inside failure cards', () => {
  assert.match(app, /onClick=\{openWebUIViaServer\}/);
  assert.match(app, /Via server/);
  // Disabled rather than broken when no server is selected.
  assert.match(app, /disabled=\{!target\}/);
});

test('the proxy URL keeps tunnel coordinates in the path, never the query', () => {
  const builder = section(app, 'function buildWebUIProxyUrl(', 'function extractWebUISecret');
  assert.match(builder, /\/api\/agents\/webui-proxy\/m\/\$\{encodeURIComponent\(connectionId\)\}/);
  // The query form evaporates on the first lazy chunk (RFC 3986 relative
  // resolution drops the base URL's query).
  assert.doesNotMatch(builder, /webui-proxy\?connectionId=/);
  // Only route metadata may ride in the query; connectionId/port are positional.
  assert.match(builder, /\?agent=\$\{encodeURIComponent\(agentId\)\}/);
  assert.match(builder, /preferredRelay/);
  assert.match(readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8'), /requestedSshMode/);
  assert.match(readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8'), /requestedRelay/);
});

test('relay-start fails instead of handing the browser a guessed port', () => {
  for (const [name, src, fallbackPort] of [['nanobot', nanobot, '18790'], ['hermes', hermes, '18791']]) {
    const block = section(src, "if (op === 'relay-start') {", "if (op === 'start' || op === 'restart')");
    // The old code did `Number(ackedPort) || 18790` and returned success:true —
    // sending the tab to an address nobody was listening on.
    assert.doesNotMatch(block, new RegExp(`Number\\(ackedPort\\) \\|\\| ${fallbackPort}`), `${name} still guesses a port`);
    assert.match(block, /Number\(ackedPort\) \|\| 0/);
    assert.match(block, /if \(!localPort\)/);
    assert.match(block, /success: false/);
    assert.match(block, /status: 504/);
  }
});

test('the injected tab HTML contains no backtick that would end the literal', () => {
  // Code handed to doc.write() is built by concatenation today, but the
  // moment someone converts it to a template literal a single backtick — even
  // in a comment — silently terminates it. Guard the code, not the prose.
  const stripComments = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const code = stripComments(tabHelpers) + stripComments(section(app, 'const failWebUITab = (tab, {', '// Claim a blank browser tab'));
  assert.doesNotMatch(code, /`/);
});

test('failure cards escape user-controlled text before writing it into the tab', () => {
  // Reason strings come from server error messages — unescaped, they are an
  // injection vector straight into a document we control.
  assert.match(tabHelpers, /const escWebUI =/);
  assert.match(tabHelpers, /escWebUI\(reason\)/);
  assert.match(tabHelpers, /escWebUI\(detail\)/);
});
