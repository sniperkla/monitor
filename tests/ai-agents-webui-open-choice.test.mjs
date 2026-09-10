import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Opening the agent Web UI must offer TWO transports and both must be
 * reachable from a phone in standard (non-desktop) mobile mode.
 *
 * Background: the external-tab route was the only option, and it is built on
 * three things a phone does not have — an escapable popup blocker, a Local
 * Relay of its own, and a 127.0.0.1 that is not the phone. Requesting the
 * desktop site on a phone changed the user agent, which flipped the
 * `isMobileBrowser` heuristic and made it *look* like the fix; in standard
 * mobile mode it stayed broken. The in-app route (same-origin proxy in an
 * iframe) is the one that genuinely works everywhere.
 *
 * Locked in here:
 *   1. both options are offered, and the choice is remembered per device,
 *   2. the in-app view frames the SAME-ORIGIN proxy — never 127.0.0.1,
 *   3. the in-app view probes before mounting, so a failure is a retryable
 *      card instead of a permanently "refused to connect" frame,
 *   4. the external route has a non-popup fallback (synthetic <a> click),
 *   5. "Start Web UI" does not claim a tab it is not going to use.
 */

const app = readFileSync('src/apps/AIAgentsApp.js', 'utf8');
const viewer = readFileSync('src/components/AgentWebUIView.js', 'utf8');
const modal = readFileSync('src/components/WebUIOpenChoiceModal.js', 'utf8');
const modeUtil = readFileSync('src/utils/webuiOpenMode.js', 'utf8');

function section(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? src.indexOf(end, from) : src.length;
  return src.slice(from, to < 0 ? src.length : to);
}

const startHandler = section(app, 'const handleStartWebUI = async () => {', '// Keep the ref in sync');
const fork = section(app, '// ── The two-openings fork', 'const act = async (label, fn)');

test('the choice modal offers exactly the two transports', () => {
  assert.match(modal, /data-webui-open-mode="in-app"/);
  assert.match(modal, /data-webui-open-mode="external"/);
  assert.match(modal, /WEBUI_OPEN_MODE_IN_APP/);
  assert.match(modal, /WEBUI_OPEN_MODE_EXTERNAL/);
  // In-app is called out as the recommended option on phones — that is the
  // whole reason the fork exists.
  assert.match(modal, /isMobile && \(/);
  assert.match(modal, /RECOMMENDED/);
});

test('the choice is remembered per DEVICE, not per account', () => {
  assert.match(modeUtil, /ssh_monitor_webui_open_mode/);
  assert.match(modeUtil, /localStorage/);
  // Only the two known modes are honoured; junk in storage must not wedge it.
  assert.match(modeUtil, /VALID_MODES\.includes\(v\)/);
  assert.match(modeUtil, /export function writeWebUIOpenMode/);
});

test('remembering a mode routes the Open button straight there', () => {
  assert.match(fork, /const resolvedWebUIOpenMode = \(\)/);
  assert.match(fork, /if \(mode === WEBUI_OPEN_MODE_IN_APP\)/);
  assert.match(fork, /openEmbeddedWebUI\(\);/);
  assert.match(fork, /if \(mode === WEBUI_OPEN_MODE_EXTERNAL\)/);
  // No memory and no mode → ask instead of guessing.
  assert.match(fork, /setWebUIChoiceOpen\(true\)/);
});

test('the picker writes the preference before acting on it', () => {
  const handler = section(fork, 'const handleWebUIOpenChoice = (', 'const act = async');
  assert.match(handler, /writeWebUIOpenMode\(mode\)/);
  assert.match(handler, /setWebUIChoiceOpen\(false\)/);
  // Comment records why this must stay synchronous.
  assert.match(fork, /user-gesture/);
});

test('the in-app view frames the same-origin proxy, never a loopback address', () => {
  // The URL handed to the viewer is the proxy builder's output.
  const openEmbedded = section(fork, 'const openEmbeddedWebUI = () => {', 'const requestOpenWebUI');
  assert.match(openEmbedded, /const url = webUIProxyUrl\(\);/);
  assert.doesNotMatch(openEmbedded, /127\.0\.0\.1/);
  // The viewer renders it in a frame, and only after a successful probe.
  assert.match(viewer, /<iframe/);
  assert.match(viewer, /src=\{frameSrc \|\| url\}/);
});

test('an escape from the tunnel is caught and pulled back in', () => {
  // A hosted app served from its own root links to bare paths like
  // "/chat/<id>". Under the proxy that is not the tunnel, so the frame gets a
  // 404 — while the same click through Local Relay (where the app really is at
  // the root) works. That asymmetry is the "works in a tab, not embedded"
  // report. Only an embed can watch for it, because only an embed is
  // same-origin and therefore readable.
  assert.match(viewer, /frame\.contentWindow\?\.location\?\.href/);
  assert.match(viewer, /href\.indexOf\(base\[0\]\) !== -1\) return;/);
  // The repair keeps the path the app asked for instead of dumping the user
  // back at the entry screen.
  assert.match(viewer, /setFrameSrc\(base\[0\] \+ escaped\.pathname/);
  assert.match(viewer, /setEscapeNotice\(escaped\.pathname/);
  // Back off after a repair so the reloaded frame is not judged mid-load.
  assert.match(viewer, /Date\.now\(\) - lastRepairRef\.current < 2500/);
});

test('a bare same-origin link is contained instead of leaving the tunnel', () => {
  const route = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');
  const handler = section(route, "document.addEventListener('click'", 'var origWindowOpen');
  // pushState is patched, but a real <a> click never reaches it — this is the
  // case that was missing.
  assert.match(handler, /containInTunnel\(href\)/);
  // An "open elsewhere" gesture is the user's, not ours — leave it alone.
  assert.match(handler, /el\.target && el\.target !== '_self'\) return;/);
  assert.match(handler, /e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey\) return;/);
});

test('the in-app view probes before mounting, so a failure is retryable', () => {
  // The frame that got removed in 2025 pointed straight at 127.0.0.1:<tunnel>
  // and committed a connection error it could never recover from. Probing
  // turns that into an HTTP status we can read and offer a Retry for.
  assert.match(viewer, /setPhase\('loading'\)/);
  assert.match(viewer, /await fetch\(url, \{/);
  assert.match(viewer, /credentials: 'include'/);
  assert.match(viewer, /if \(!res\.ok\)/);
  assert.match(viewer, /setPhase\('error'\)/);
  assert.match(viewer, /setPhase\('ready'\)/);
  assert.match(viewer, /phase === 'ready' &&/);
  // Retry re-runs the probe rather than reloading a dead frame.
  assert.match(viewer, /setNonce\(\(n\) => n \+ 1\)/);
  // Probe is abortable, so a hung server cannot spin forever.
  assert.match(viewer, /AbortController/);
  assert.match(viewer, /PROBE_TIMEOUT_MS/);
});

test('the in-app view is portal-ed and mobile-sized', () => {
  // A fixed child of the transformed window container is not really fixed, so
  // it has to render into <body>.
  assert.match(viewer, /createPortal\(/);
  assert.match(viewer, /document\.body/);
  assert.match(viewer, /env\(safe-area-inset-top\)/);
  // Tap targets: 44px on touch, compact from sm: up.
  assert.match(viewer, /w-11 h-11 sm:w-8 sm:h-8/);
  assert.match(viewer, /min-h-\[44px\]/);
});

test('Back dismisses the in-app overlay instead of navigating the app away', () => {
  const hist = section(viewer, '// Back closes the overlay.', 'if (!open || typeof document');
  assert.match(hist, /window\.history\.pushState\(\{/);
  assert.match(hist, /agentWebUIView: true/);
  assert.match(hist, /addEventListener\('popstate', onPop\)/);
  // Only OUR entry is popped — otherwise Back would leave the app entirely.
  assert.match(hist, /window\.history\.state\?\.agentWebUIView\) \{\s*\n\s*window\.history\.back\(\)/);
  // onClose is held in a ref: it is a fresh closure each render, so keying the
  // effect on it would re-run it constantly.
  assert.match(hist, /onCloseRef/);
  assert.doesNotMatch(hist, /\[open, onClose\]/);
});

test('the Back entry is pushed once per open, not once per render', () => {
  // StrictMode (default in Next 16) runs mount → unmount → mount. An
  // unguarded push/back pair then pops the entry the remount just pushed and
  // the panel closes itself the moment it opens. The refs break that cycle.
  const hist = section(viewer, '// Back closes the overlay.', 'if (!open || typeof document');
  assert.match(hist, /historyPushedRef/);
  assert.match(hist, /if \(!historyPushedRef\.current\)/);
  assert.match(hist, /historyPushedRef\.current = false;\s*\n\s*if \(!historyPoppedRef\.current/);
});

test('the embedded panel drags, minimises and maximises', () => {
  assert.match(viewer, /onPointerDown=\{beginMove\}/);
  // Pointer events, not the live-log panel's mousedown/move/up trio — that
  // trio does nothing on a touchscreen, and this panel has to work on a phone.
  assert.doesNotMatch(viewer, /onMouseDown=/);
  // Without this, a touch drag scrolls the page instead of moving the panel.
  assert.match(viewer, /touchAction: 'none'/);
  // Listeners live on window, so a drag that outruns the handle still tracks.
  assert.match(viewer, /window\.addEventListener\('pointermove', onMove\)/);
  // Dragging a maximised or minimised panel would just fight those buttons.
  assert.match(viewer, /if \(maximized \|\| minimized\) return;/);
  // A drag that starts on a control is a click.
  assert.match(viewer, /e\.target\.closest\?\.\('button'\)/);
  assert.match(viewer, /setMaximized\(\(v\) => !v\)/);
});

test('the panel resizes from its right edge, bottom edge and corner', () => {
  assert.match(viewer, /beginResize\(e, 'e'\)/);
  assert.match(viewer, /beginResize\(e, 's'\)/);
  assert.match(viewer, /beginResize\(e, 'se'\)/);
  // Minimums, so a stray gesture cannot collapse it to nothing.
  assert.match(viewer, /MIN_W/);
  assert.match(viewer, /MIN_H/);
  // Every resize is clamped back on screen.
  assert.match(viewer, /clampGeom/);
  assert.match(viewer, /cursor-nwse-resize/);
});

test('dragging to an edge docks the panel as a full-height side pane', () => {
  assert.match(viewer, /data-webui-dock=\{dock\}/);
  assert.match(viewer, /dockThreshold/);
  // A translucent hint while hovering the edge...
  assert.match(viewer, /data-webui-dock-preview/);
  // ...and the dock only commits on release, never on hover.
  assert.match(viewer, /if \(target\) setDock\(target\)/);
  // Docked means pinned to the edge, full height, fixed width.
  assert.match(viewer, /left: 0, top: 0, bottom: 0, width: dockW/);
  assert.match(viewer, /right: 0, top: 0, bottom: 0, width: dockW/);
});

test('a docked pane resizes from its inner edge and detaches intact', () => {
  // Inner edge only — the outer edge is the screen edge and cannot move.
  assert.match(viewer, /dock === 'left' \? d\.start\.w \+ dx : d\.start\.w - dx/);
  // Explicit detach buttons, for anyone who does not want to drag.
  assert.match(viewer, /setDock\(\(d\) => \(d === 'left' \? 'none' : 'left'\)\)/);
  assert.match(viewer, /setDock\(\(d\) => \(d === 'right' \? 'none' : 'right'\)\)/);
  assert.match(viewer, /MIN_DOCK_W/);
  // Dragging a docked panel out must not teleport it: it gets a floating box
  // under the cursor, and `geom` survives so un-docking restores the layout.
  assert.match(viewer, /if \(dock !== 'none'\) \{/);
});

test('a phone gets no dock affordance — there is no room for a side pane', () => {
  assert.match(viewer, /setNarrow\(window\.innerWidth < 768\)/);
  assert.match(viewer, /\{!narrow && \(/);
});

test('minimising hides the panel without unmounting the frame', () => {
  assert.match(viewer, /setMinimized\(true\)/);
  // A 'hidden' class, not conditional rendering: unmounting the iframe would
  // drop the agent's socket, its scroll position and any half-typed message.
  assert.match(viewer, /minimized \? 'hidden' : ''/);
  const badge = section(viewer, 'Minimised badge', 'document.body');
  assert.match(badge, /setMinimized\(false\)/);
  assert.match(badge, /onClose\?\.\(\)/);
});

test('the frame stops swallowing the pointer stream while dragging', () => {
  // An iframe under the cursor eats pointermove, so the panel would jump and
  // stick mid-drag without this.
  assert.match(viewer, /pointerEvents: dragging \? 'none' : undefined/);
});

test('a phone gets the maximised panel, a desktop the floating one', () => {
  // A 1100x760 window dragged around a 375px screen is not a feature.
  assert.match(viewer, /const isNarrow = window\.innerWidth < 768;/);
  assert.match(viewer, /setMaximized\(isNarrow\)/);
  assert.match(viewer, /floatingGeom/);
  // A shrinking viewport must not strand the panel off-screen.
  assert.match(viewer, /addEventListener\('resize'/);
});

test('the external route has a fallback that is not window.open', () => {
  // Mobile Safari and iOS standalone refuse window.open outright; a synthetic
  // <a target="_blank"> activation still opens a tab. This is the concrete
  // reason "new tab" failed on phones in standard mobile mode.
  assert.match(modeUtil, /export function openExternalUrl/);
  const fn = section(modeUtil, 'export function openExternalUrl', 'export const');
  assert.match(fn, /window\.open\(url, '_blank'\)/);
  assert.match(fn, /document\.createElement\('a'\)/);
  assert.match(fn, /a\.target = '_blank'/);
  assert.match(fn, /a\.click\(\)/);
  // No `features` argument: it would turn the tab into a sized popup on desktop.
  assert.doesNotMatch(fn, /window\.open\(url, '_blank',/);
  // Both call sites that open a tab now go through it.
  assert.match(app, /if \(openExternalUrl\(mobileUrl\)\)/);
  assert.match(app, /if \(openExternalUrl\(url\)\)/);
});

test('Start Web UI only claims a tab when the external route is the chosen one', () => {
  // Claiming one unconditionally left a stray blank tab behind for anyone who
  // prefers the in-app view — and for everyone who had not chosen yet.
  assert.match(startHandler, /const prefMode = webUIOpenMode \|\| readWebUIOpenMode\(\) \|\| '';/);
  assert.match(startHandler, /prefMode === WEBUI_OPEN_MODE_EXTERNAL \? openBlankWebUITab\(\) : null/);
  // After a successful start it honours the same fork.
  const afterStart = section(startHandler, 'if (prefMode === WEBUI_OPEN_MODE_IN_APP)', '} finally {');
  assert.match(afterStart, /openEmbeddedWebUI\(\);/);
  assert.match(afterStart, /openWebUIInTab\(r\?\.webUIBootstrapPath, startTab\)/);
  assert.match(afterStart, /setWebUIChoiceOpen\(true\)/);
});

test('the Open button re-opens the chooser without needing a reset', () => {
  assert.match(app, /data-open-webui-btn/);
  assert.match(app, /data-open-webui-mode-btn/);
  const btn = section(app, 'data-open-webui-mode-btn', 'title="Choose how the Web UI opens');
  assert.match(btn, /setWebUIChoiceOpen\(true\)/);
});

test('the proxy route already permits same-origin framing', () => {
  // If this ever regresses the in-app view is blank, so it is asserted here
  // rather than discovered on a phone.
  const route = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');
  assert.match(route, /'X-Frame-Options': 'SAMEORIGIN'/);
  assert.match(route, /frame-ancestors 'self'/);
});
