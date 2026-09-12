import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('src/proxy.js excludes api/browser/proxy from middleware negative lookahead', () => {
  const proxySrc = readFileSync('src/proxy.js', 'utf8');
  assert.match(
    proxySrc,
    /api\/agents\/webui-proxy\|api\/browser\/proxy/,
    'api/browser/proxy must be exempted from proxy.js matcher so frame-ancestors none does not block iframes'
  );
});

test('server.js configures SAMEORIGIN framing for /api/browser/proxy', () => {
  const serverSrc = readFileSync('server.js', 'utf8');
  assert.match(
    serverSrc,
    /req\.url\.startsWith\('\/api\/browser\/proxy'\)/,
    'server.js must detect /api/browser/proxy and assign SAMEORIGIN / frame-ancestors self headers'
  );
});

test('next.config.mjs specifies framing headers for /api/browser/proxy', () => {
  const nextConfigSrc = readFileSync('next.config.mjs', 'utf8');
  assert.match(
    nextConfigSrc,
    /source:\s*'\/api\/browser\/proxy'/,
    'next.config.mjs must contain a header rule for /api/browser/proxy'
  );
});

test('browser proxy route specifies SAMEORIGIN framing and injects navigation helper', () => {
  const routeSrc = readFileSync('src/app/api/browser/proxy/route.js', 'utf8');
  assert.match(routeSrc, /safeHeaders\.set\('X-Frame-Options',\s*'SAMEORIGIN'\)/);
  assert.match(routeSrc, /safeHeaders\.set\('Content-Security-Policy',\s*"frame-ancestors 'self'"\)/);
  assert.match(routeSrc, /safeHeaders\.set\('Cross-Origin-Resource-Policy',\s*'cross-origin'\)/);
  assert.match(routeSrc, /function goto\(u, kind\)/, 'HTML responses must inject the navigation bridge');
});

/**
 * Regression: Chromium refuses to render a nested document whose COEP is
 * `unsafe-none` (or absent) when the embedder declares `credentialless` — the
 * frame dies with ERR_BLOCKED_BY_RESPONSE and blockedReason
 * `coep-frame-resource-needs-coep-header`, even same-origin. That is what made
 * every Web Browser tab, and the in-app agent Web UI, show a blank frame.
 *
 * Measured in Chrome 128 against a throwaway origin: with the parent at
 * `credentialless`, a child at `unsafe-none` / absent is blocked, while a child
 * at `credentialless` or `require-corp` loads.
 */
test('proxied iframe routes declare a COEP at least as strict as the app shell', () => {
  const files = [
    'src/app/api/browser/proxy/route.js',
    'src/app/api/agents/webui-proxy/route.js',
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(
      src,
      /Cross-Origin-Embedder-Policy'?:?\s*'?unsafe-none/i,
      `${f} must not opt its framed response out of COEP`
    );
    assert.match(
      src,
      /Cross-Origin-Embedder-Policy'?:?\s*'?credentialless/i,
      `${f} must emit COEP credentialless to match the shell`
    );
  }
});

test('server.js and next.config.mjs share one COEP value for shell and proxies', () => {
  const serverSrc = readFileSync('server.js', 'utf8');
  const nextSrc = readFileSync('next.config.mjs', 'utf8');

  // server.js: the proxy branch must no longer special-case unsafe-none
  assert.doesNotMatch(
    serverSrc,
    /isWebUIProxy\s*\?\s*'unsafe-none'/,
    'server.js must not give proxied routes a weaker COEP than the shell'
  );
  assert.match(serverSrc, /function coepValue\(\)/, 'server.js must expose the shared COEP helper');

  // next.config.mjs: every framing rule must use the shared constant.
  // Comments are stripped first — the rationale text legitimately names the
  // value we are banning.
  const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '');
  const framingRules = nextSrc.match(/source:\s*'\/api\/(browser|agents)\/[^']*'[\s\S]*?\],\s*\}/g) || [];
  assert.ok(framingRules.length >= 2, 'expected framing rules for both proxy routes');
  for (const rule of framingRules) {
    const code = stripComments(rule);
    assert.match(code, /value:\s*COEP/, 'framing rules must use the shared COEP constant');
    assert.doesNotMatch(code, /unsafe-none/, 'framing rules must not hardcode unsafe-none');
  }
});

/**
 * Reversed 2026-09-11: ordinary sites used to be handed to a real browser tab
 * (`openDirectWebsite` → `openExternalUrl`), which was honest but was not what
 * the app is for. They now render IN-APP, through the relay's loopback proxy —
 * which is now REQUIRED: without a relay the tab shows the "Local Relay
 * required" state instead of the old same-origin server-proxy fallback.
 *
 * The external tab still exists, but only as an explicit escape hatch the user
 * takes — the un-embeddable banner. It must never be the default again.
 */
test('ordinary external URLs render in-app, not in a real browser tab', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

  // One helper decides the renderer, so no call site can drift.
  assert.match(appSrc, /const webTabFrame = useCallback/, 'framing must go through one helper');
  assert.match(appSrc, /frameFor\(relayProxyPort, target\)/, 'the relay is preferred');
  assert.match(appSrc, /return \{ proxyKind: 'relay-required', frameSrc: '' \}/,
    'a browser without a relay must demand one, not fall back to the server proxy');

  // The external-first path must be gone, not merely bypassed.
  assert.doesNotMatch(appSrc, /const openDirectWebsite/, 'the external-first path must be deleted');

  // And ordinary address-bar navigation must stay in-app.
  const navigateBody = appSrc.match(/const navigateAddress = \(input\) => \{[\s\S]*?\n  \};/)[0];
  assert.match(navigateBody, /webTabFrame\(destinationUrl\)/, 'navigation must render in-app');
  assert.doesNotMatch(navigateBody, /openExternalUrl|openDirectWebsite/,
    'ordinary navigation must not open a real browser tab');
});

/**
 * The Web Browser REQUIRES the Local Relay (2026-09-12): a tab without one
 * shows an explicit "Local Relay required" state with install guidance and a
 * re-check action, rather than silently rendering through the same-origin
 * server proxy. A relay that appears must re-point the required tab to a live
 * frame (self-healing), and a relay that dies gates the tab instead of
 * downgrading it.
 */
test('the Web Browser requires the Local Relay — no silent server-proxy fallback', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

  // The required state is stated unambiguously, with the install command.
  assert.match(appSrc, /Local Relay Required/, 'the gate must name what is missing');
  assert.match(appSrc, /npm install -g ssh-monitor-relay/,
    'the gate must show how to install the relay');

  // The re-check action nudges the relay status poller, whose subscription
  // re-reads the port and re-points the tab — one fetch, no duplicate.
  assert.match(appSrc, /requestRelayStatusRefresh\('browser-required'\)/,
    'the gate re-check must go through the relay status refresh event');

  // No server-proxy rendering path may remain selectable for web tabs.
  assert.doesNotMatch(appSrc, /proxyKind: 'server'/,
    'the server proxy must not be a selectable web renderer');
});
/**
 * Back/Forward used to be DELEGATED to the relay frame via postMessage, and
 * both directions appeared dead to the user (2026-09-12). Two measured causes:
 *   1. the postMessage succeeds unconditionally — even when the frame has no
 *      entry to traverse — so the parent's own stack was never consulted;
 *   2. a cross-origin frame's history.back() traverses the JOINT session
 *      history: under it the probe's whole app UI vanished (the top page went
 *      back).
 * The parent must own Back/Forward outright, which requires the stack to also
 * include the navigations the frame made by ITSELF (relative links through
 * <base href> never ask the parent) — applyPushedRoute records those.
 */
test('Back/Forward are parent-driven and the stack includes frame-native navigations', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

  // No history delegation into the cross-origin frame may remain.
  assert.doesNotMatch(appSrc, /commandRelayFrame\('(?:back|forward)'\)/,
    'Back/Forward must not delegate to the frame — the ask is a silent no-op or worse, a joint-history traversal');

  // Web tabs step the parent stack; the frame-delegation fallback is gone.
  const back = appSrc.match(/const handleBack = \(\) => \{[\s\S]*?\n  \};/)[0];
  const forward = appSrc.match(/const handleForward = \(\) => \{[\s\S]*?\n  \};/)[0];
  assert.match(back, /return stepHistory\(-1\)/, 'Back must step the parent stack');
  assert.match(forward, /return stepHistory\(1\)/, 'Forward must step the parent stack');

  // The frame's own navigations land in the stack, or Back/Forward skip them.
  const pushed = appSrc.match(/const applyPushedRoute = useCallback\([\s\S]*?\n  \}, \[\]\);/)[0];
  assert.match(pushed, /t\.proxyKind !== 'relay'/,
    'relay frame reports must be distinguished');
  assert.match(pushed, /history\.push\(target\)/,
    'a frame-native navigation must be recorded in the parent stack');
  assert.match(pushed, /historyIndex: history\.length - 1/,
    'and the cursor must move with it');
});
test('agent shortcuts use the existing external Local Relay flow when available', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  assert.match(appSrc, /if \(onOpenExternal && agId === agentId\)/);
  assert.match(appSrc, /onOpenExternal\(\)/);
});

/**
 * The proxy serves arbitrary third-party HTML from OUR origin. If the frame
 * were not sandboxed, a proxied page's JS would run as monitor.eaqdragon.com
 * and could read our DOM, our localStorage, and call same-origin APIs with the
 * user's cookies attached. Dropping allow-same-origin gives it an opaque origin.
 *
 * Verified COEP-neutral (scratch/coep-isolate.mjs): the nested-document COEP
 * rule only inspects the response header, so sandboxing does not re-trigger it.
 */
test('external web frames are sandboxed without allow-same-origin', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

  const sandboxConst = appSrc.match(/const WEB_FRAME_SANDBOX =\s*([\s\S]*?);/);
  assert.ok(sandboxConst, 'WEB_FRAME_SANDBOX must be defined');
  const value = sandboxConst[1];
  assert.doesNotMatch(value, /allow-same-origin/, 'the sandbox must not grant same-origin');
  assert.doesNotMatch(value, /allow-top-navigation/, 'a proxied page must not navigate the app away');
  assert.doesNotMatch(value, /allow-downloads/, 'no silent downloads out of a browsing proxy');
  assert.match(value, /allow-scripts/, 'the page still needs to run its own JS');

  // Applied to external web only — the trusted agent Web UI needs same-origin,
  // and the relay-rendered frame is cross-origin to us so it needs no sandbox
  // (and must not have one: an opaque origin breaks storage).
  //
  // Every tab's frame is rendered from the same map now, so the condition reads
  // the per-tab `tab` rather than `activeTab`: sandboxing must follow the tab
  // that OWNS the frame, not whichever tab happens to be on screen.
  assert.match(
    appSrc,
    /sandbox=\{[^}]*tab\.type === 'web'[^}]*WEB_FRAME_SANDBOX[^}]*\}/,
    'sandbox must be conditional on the external-web tab type'
  );
});

/**
 * The relay-proxied frame must NOT be sandboxed, and that is a functional
 * requirement rather than a style choice.
 *
 * A sandbox without `allow-same-origin` gives the page an OPAQUE origin, and an
 * opaque origin cannot touch localStorage — measured: on youtube.com the frame
 * painted its grey skeleton and stopped. The relay exists precisely so the page
 * gets a real origin instead. Measured through the relay: localStorage is
 * writable and youtube.com renders its full home page.
 *
 * The safety argument is unchanged: the relay frame is a DIFFERENT ORIGIN
 * (127.0.0.1:<port>) from the app, so it cannot reach our DOM, storage or
 * same-origin APIs with the user's cookies. Cross-origin, not sandboxed.
 */
test('relay-rendered frames are not sandboxed, because an opaque origin breaks storage', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  assert.match(
    appSrc,
    /sandbox=\{[^}]*proxyKind !== 'relay'[^}]*\}/,
    'the relay frame must be exempt from the sandbox'
  );
  // Both branches must still exist: the server-proxied frame IS sandboxed.
  assert.match(appSrc, /WEB_FRAME_SANDBOX/, 'the server-proxied frame must stay sandboxed');
});

/**
 * A sandboxed frame has an OPAQUE origin, so its own navigations are cross-site
 * and arrive WITHOUT the SameSite=Lax session cookie — the proxy answers 401
 * and every link click lands on "Unauthorized". Measured: the initial
 * parent-initiated load returns 200, an in-frame link click returned 401.
 *
 * So the page must not navigate itself; it asks the parent, whose navigation
 * does carry the cookie. Back/forward likewise cannot use the frame's history
 * (unreachable across the sandbox), so the parent keeps its own stack.
 */
test('sandboxed web frames hand navigation to the parent instead of self-navigating', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  const routeSrc = readFileSync('src/app/api/browser/proxy/route.js', 'utf8');

  // The injected page asks to be moved; it must not assign location itself.
  assert.match(routeSrc, /post\(\{ \[MSG\]: kind \|\| 'goto', url: abs \}\)/,
    'the page must request navigation');
  assert.doesNotMatch(routeSrc, /window\.location\.href = toProxy/,
    'the page must not navigate itself — that loses the session cookie');
  assert.doesNotMatch(routeSrc, /function toProxy\(u\)/,
    'self-navigation wrapping must be gone entirely');

  // The parent performs it, and owns history because contentWindow is unreachable.
  assert.match(appSrc, /const navigateTab = useCallback/, 'the parent must own web navigation');
  assert.match(appSrc, /const stepHistory = useCallback/, 'the parent must own the history stack');
  assert.match(appSrc, /stepHistory\(-1\)/);
  assert.match(appSrc, /stepHistory\(1\)/);
  assert.doesNotMatch(appSrc, /postFrameCmd/, 'no frame-driven back/forward remains');

  // A sandboxed frame is cross-origin: reading its location throws, so the
  // address bar can only be kept in step by the page reporting itself.
  //
  // The sender is resolved by matching `event.source` against the frame that
  // owns it, rather than against a single "current" frame: every tab's frame
  // stays mounted, so a message can legitimately arrive from a hidden tab and
  // must be credited to THAT tab.
  assert.match(
    appSrc,
    /for \(const \[id, el\] of frameRefsRef\.current\)[\s\S]{0,160}el\.contentWindow === e\.source/,
    'the message handler must identify the sending tab so another window cannot drive the tab'
  );
  assert.doesNotMatch(appSrc, /e\.source !== frameRef\.current\?\.contentWindow/,
    'attribution must not assume the message came from the active tab');
  assert.match(routeSrc, /post\(\{ \[MSG\]: 'nav', href: location\.href \}\)/, 'the page must report its location');

  // Never fall back to the bare target URL: that bypasses the proxy entirely.
  assert.doesNotMatch(appSrc, /frameRef\.current\.src = activeTab\?\.frameSrc \|\| activeTab\?\.url/,
    'reload must not fall back to the unwrapped target URL');
});

test('the omnibox shows the real destination, not the internal proxy URL', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  // `frameSrc` is /api/browser/proxy?url=…; `url` is the actual target.
  assert.match(
    appSrc,
    /setAddressInput\(activeTab\?\.url \|\| activeTab\?\.frameSrc \|\| ''\)/,
    'the address bar must prefer the real URL over the proxy wrapper'
  );
});

/**
 * target="_blank" must become a tab, not an OS popup.
 *
 * Measured (scratch/browser-blank-link-probe.mjs): left to the browser, the
 * anchor opens a native popup that INHERITS the frame's opaque origin — the
 * target site rendered logged out (document.cookie → SecurityError) in a
 * separate window outside the app's own tab bar. The app already has tabs, and
 * every real browser opens `_blank` in a tab, so hand it to the parent.
 */
test('target="_blank" opens a new in-app tab instead of an OS popup', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  const routeSrc = readFileSync('src/app/api/browser/proxy/route.js', 'utf8');

  // The page must stop letting _blank fall through to the native popup.
  assert.doesNotMatch(routeSrc, /if \(a\.target === '_blank'\) return;/,
    'the _blank early-return must be gone — it let the logged-out popup through');
  assert.match(routeSrc, /a\.target === '_blank' \? 'newtab' : 'goto'/,
    'the page must distinguish a new-tab click from an in-place navigation');

  // The parent opens it as a first-class web tab: proxied, titled, with history.
  assert.match(appSrc, /const openWebTab = useCallback/, 'the parent must own new-tab creation');
  assert.match(appSrc, /data\[WEB_FRAME_MSG\] === 'newtab'/, 'the bridge must handle newtab');
  // The new tab goes through the same renderer choice as everything else, so a
  // _blank click gets the relay too — not the server proxy by accident.
  assert.match(appSrc, /frameSrc: webTabFrame\(href\)\.frameSrc|webTabFrame\(href\)/,
    'the new tab must go through the shared renderer choice');
  assert.match(appSrc, /const handleNewTab = useCallback/,
    'handleNewTab must be stable or the bridge effect re-subscribes every render');
  assert.match(appSrc, /history: isWeb && initialProps\.url/,
    'a web tab needs a history stack from birth or Back has nothing to pop');
});

/**
 * An opaque origin cannot change its own URL, so an SPA router's
 * `history.pushState({}, '', '/route')` throws SecurityError — and it throws
 * inside the page's own click handler, so the router dies and the site stops
 * responding to clicks. Measured (scratch/browser-xhr-probe.mjs): replaceState
 * to the *same* URL is allowed, any pushState to a different path is not.
 *
 * We cannot contain the URL the way the agent WebUI tunnel does — that frame is
 * same-origin, ours is opaque, so even a same-origin URL is refused. Swallow it.
 */
test('SPA pushState/replaceState is swallowed instead of throwing', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  const routeSrc = readFileSync('src/app/api/browser/proxy/route.js', 'utf8');

  assert.match(routeSrc, /history\.pushState = function\(state, title, url\) \{ reportPush\(url\); \}/,
    'pushState must be swallowed');
  assert.match(routeSrc, /history\.replaceState = function\(state, title, url\) \{ reportPush\(url\); \}/,
    'replaceState must be swallowed');
  assert.doesNotMatch(routeSrc, /origPushState\(/,
    'must not delegate to the original — it throws on an opaque origin');

  // Display-only: the omnibox follows the route, but the parent must NOT treat
  // it as a real navigation (that would put a guessed URL on the history stack).
  // It also cannot reuse applyFrameUrl, which unwraps a proxy URL and bails on
  // a bare destination.
  const pushBranch = appSrc.match(/\} else if \(data\[WEB_FRAME_MSG\] === 'push'[\s\S]*?\n      \}/);
  assert.ok(pushBranch, "the bridge must handle 'push'");
  assert.match(pushBranch[0], /applyPushedRoute/, 'push updates the omnibox via its own handler');
  assert.doesNotMatch(pushBranch[0], /applyFrameUrl/,
    'applyFrameUrl unwraps a proxy URL and would silently drop a bare route');
  assert.doesNotMatch(pushBranch[0], /navigateTab/, 'push must not navigate or touch history');
  assert.match(appSrc, /const applyPushedRoute = useCallback/, 'the handler must exist');
});

/**
 * The whole injected script is ONE JS template literal. A single stray backtick
 * inside it — in a comment, most easily — closes the literal early, leaves the
 * rest of the script as top-level garbage, and 500s the route. This actually
 * happened while adding the pushState handler.
 *
 * eslint catches it as a parse error, but only if you lint the file; this test
 * catches it in `npm test`.
 */
test('the injected script template literal is not terminated early by a backtick', () => {
  const routeSrc = readFileSync('src/app/api/browser/proxy/route.js', 'utf8');

  const open = 'const navScript = `';
  const start = routeSrc.indexOf(open);
  assert.ok(start >= 0, 'navScript must be declared as a template literal');

  const end = routeSrc.indexOf('`;', start + open.length);
  assert.ok(end > start, 'navScript template literal must be closed');

  const body = routeSrc.slice(start + open.length, end);
  assert.ok(!body.includes('`'), 'no backtick may appear inside the injected script');

  // Proves the literal ran to the END of the script rather than stopping at a
  // stray backtick somewhere in the middle.
  assert.match(body, /\}\)\(\);\n<\/script>\s*$/,
    'the literal must extend to the end of the injected script');
  assert.ok(body.includes('reportPush') && body.includes('newtab'),
    'the capture must include the whole bridge, not a truncated prefix');
});

/**
 * A POST form would navigate the sandboxed frame straight to the TARGET origin,
 * and only the proxy sets the COEP header a nested document needs — so the frame
 * dies with ERR_BLOCKED_BY_RESPONSE /
 * corp-not-same-origin-after-defaulted-to-same-origin-by-coep and the tab shows a
 * chrome error. Measured (scratch/browser-post-form-probe.mjs): GET stays inside
 * the proxy, POST kills the frame outright.
 *
 * Also: `form.submit()` fires NO submit event, so an event-only interceptor
 * silently misses programmatic submissions — which is exactly how the first
 * version of the probe fooled me into thinking even GET escaped.
 */
test('form submission is proxied for GET and refused with an explanation for POST', () => {
  const routeSrc = readFileSync('src/app/api/browser/proxy/route.js', 'utf8');

  assert.match(routeSrc, /function handleSubmit\(form, evt\)/, 'one handler for both entry points');
  assert.match(routeSrc, /document\.addEventListener\('submit', function\(e\) \{\n    handleSubmit\(e\.target, e\);/,
    'the submit event must route through the handler');
  assert.match(routeSrc, /HTMLFormElement\.prototype\.submit = function\(\) \{ handleSubmit\(this, null\); \}/,
    'form.submit() bypasses the submit event and must be patched too');

  assert.match(routeSrc, /if \(m !== 'get'\) \{/, 'non-GET must be refused');
  assert.match(routeSrc, /explainBlockedSubmit\(\)/, 'the refusal must explain itself');
  assert.doesNotMatch(routeSrc, /if \(m === 'post'\) return;/,
    'POST must no longer fall through to a native submission');

  // method="dialog" closes a <dialog> and never navigates — do not hijack it.
  assert.match(routeSrc, /if \(m === 'dialog'\) return;/, 'dialog forms must be left alone');

  // A proxied page must not be able to open browser tabs on its own; the notice
  // points at the toolbar button instead of offering its own link.
  assert.doesNotMatch(routeSrc, /'external'/, 'no page-triggered external opens');
});

test('opaque-origin failures explain themselves instead of leaving a blank frame', () => {
  const routeSrc = readFileSync('src/app/api/browser/proxy/route.js', 'utf8');

  // The diagnosis must survive a target app replacing document.body during boot.
  assert.match(routeSrc, /document\.documentElement \|\| document\.body\)\.appendChild\(box\)/);
  assert.match(routeSrc, /function explainUnrenderable\(\)/);
  assert.match(routeSrc, /This page needs a real browser/);
  assert.match(routeSrc, /storage or network access that the in-app browser blocks/);
  assert.match(routeSrc, /scheduleUnrenderableCheck\(\);/);

  // A JS-only search fallback is not the same as a totally blank app, but it is
  // the same user-visible limitation and gets a more useful suggestion.
  assert.match(routeSrc, /jsRequiredFallback/);
  assert.match(routeSrc, /This search needs a real browser/);
  assert.match(routeSrc, /DuckDuckGo Lite/);
  assert.match(routeSrc, /window\.open = function\(url, target\)/);
  assert.doesNotMatch(routeSrc, /goto\(String\(url\), 'newtab'\)/,
    'programmatic popups must not create tabs without a user click');
});

test('self-navigation auth failures render an explanation for iframe navigations', () => {
  const routeSrc = readFileSync('src/app/api/browser/proxy/route.js', 'utf8');

  assert.match(routeSrc, /function unauthenticatedResponse\(request\)/);
  assert.match(routeSrc, /dest === 'iframe' && mode === 'navigate'/);
  assert.match(routeSrc, /Navigation Blocked/);
  assert.match(routeSrc, /This page tried to navigate itself/);
  assert.match(routeSrc, /return new NextResponse\('Unauthorized', \{ status: 401 \}\)/);
  assert.match(routeSrc, /unauthenticatedResponse\(request\)/);
});

/**
 * The relay re-binds to `18780 + n` when the port is taken (EADDRINUSE retry —
 * a second relay on the same machine is enough) and disappears entirely when it
 * stops. A port read ONCE at mount therefore goes stale, and the next
 * navigation in an already-open tab fails with
 * **"127.0.0.1 refused to connect"** — while the tab still looks fine, because
 * an already-loaded document needs no further connections.
 *
 * Measured on the user's own relay: it was re-paired mid-session, so this is a
 * live condition rather than a hypothetical.
 */
test('the relay web-proxy port is re-read when relay status changes', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

  // It must subscribe, not just read once — that was the bug.
  assert.match(appSrc, /import \{[^}]*onRelayStatusRefresh[^}]*\} from '@\/utils\/relayStatus'/,
    'the app must subscribe to relay status changes');
  assert.match(appSrc, /return onRelayStatusRefresh\(\(\) => \{ refreshRelayPort\(\); \}\)/,
    'the mount read must be re-run on every relay status refresh');

  // And re-point the relay tabs it owns, through the same pure helper the rest
  // of the app uses, so a new port cannot produce a differently-shaped URL.
  const body = appSrc.match(/const refreshRelayPort = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[\]\);/)[0];
  assert.match(body, /fetchRelayStatus\(\)/, 'the read must ask for the current port');
  assert.match(body, /port = Number\(status\.webProxyPort\) \|\| 0/,
    'the port must be coerced, with 0 meaning "no relay"');
  assert.match(body, /if \(port === relayPortRef\.current\) return 0;/,
    'an unchanged port must not touch the tabs');
  assert.match(body, /frameFor\(port, t\.url\)/, 'relay tabs must be re-pointed at the new port');
  assert.match(body, /const wantsRelay = t\.proxyKind === 'relay' \|\| t\.proxyKind === 'relay-required'/,
    'relay tabs AND relay-required tabs must be re-pointed when the port changes');

  // A transient failure must keep the port we have: tearing down working frames
  // on a blip is worse than a stale port.
  assert.match(body, /catch \{[\s\S]*?return 0;\n    \}/,
    'a failed status read must not clear the port');

  // A silent relay restart fires NO refresh event, so the mount/status
  // subscription alone cannot cover the reported failure. The probe re-reads
  // the port when a relay frame fails, which is the case that actually happens.
  const probe = appSrc.match(/const armRelayProbe = useCallback\(\(tabId\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)[0];
  assert.match(probe, /const movedTo = await refreshRelayPort\(\)/,
    'a failed relay frame must re-read the port before being demoted');
  assert.match(probe, /if \(movedTo > 0\) return;/,
    'a relay that merely moved must be followed, not demoted to the server proxy');
  assert.match(probe, /proxyKind: 'relay-required'/, 'and a genuinely dead relay puts the tab on the required state');
});

/**
 * Switching tabs used to reload the page every time, because the viewport
 * rendered only the active tab's frame — so the switch changed `src`.
 *
 * Real browsers keep background tabs alive; so does this now. That is what
 * makes a half-filled form, a scroll position or a playing video survive.
 */
test('every tab frame stays mounted so a tab switch does not reload the page', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

  // The viewport maps over the tabs, not over the active one.
  // The viewport maps over the tabs, not over the active one. The map body
  // starts with the relay-required gate, then derives per-tab showability.
  assert.match(appSrc, /\{tabs\.map\(\(tab\) => \{/, 'the viewport must render one frame per tab');
  assert.match(appSrc, /const showable = \(tab\.type === 'webui' && tab\.phase === 'ready'\) \|\| tab\.type === 'web';/,
    'the viewport must derive showability per tab');
  assert.doesNotMatch(appSrc, /src=\{activeTab\?\.frameSrc \|\| activeTab\?\.url\}/,
    'the frame src must come from the tab being rendered, not from the active tab');

  // Inactive frames are hidden, not unmounted. `hidden` alone can be beaten by
  // a display utility, so visibility is set too.
  assert.match(appSrc, /hidden=\{!isActive\}/, 'the inactive frame must be hidden');
  assert.match(appSrc, /style=\{isActive \? undefined : \{ visibility: 'hidden' \}\}/,
    'and visibility-hidden, so a display utility cannot stack two pages');

  // `frameRef` can no longer be a `ref` prop (that would point at whichever
  // frame mounted last) — it has to be re-pointed at the active tab's frame.
  assert.match(appSrc, /frameRef\.current = frameRefsRef\.current\.get\(activeTabId\) \|\| null/,
    'the active frame must be resolved from the mounted-frame map');
  assert.doesNotMatch(appSrc, /ref=\{frameRef\}/,
    'a single ref prop cannot identify the active frame any more');

  // Every frame registers itself so the message bridge can attribute senders.
  assert.match(appSrc, /frameRefsRef\.current\.set\(tab\.id, el\)/, 'frames must register by tab id');
  assert.match(appSrc, /frameRefsRef\.current\.delete\(tab\.id\)/, 'and deregister on unmount');
});

/**
 * The consequence of keeping frames mounted: a relay frame announces itself
 * ('ready') exactly ONCE, at document parse. If the fallback probe were re-armed
 * on every tab switch it would time out 6s later and demote a perfectly good
 * relay page to the sandboxed server proxy — a regression that only shows up
 * after the second visit to a tab.
 */
test('an already-loaded relay frame is not re-probed when its tab is revisited', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

  assert.match(appSrc, /const relayReadyRef = useRef\(new Map\(\)\)/,
    'readiness must be tracked per tab');
  // Keyed by the src that reported ready, so it self-invalidates on a port
  // change, a new address, or a Back — no call site has to remember to clear it.
  assert.match(appSrc, /relayReadyRef\.current\.set\(tabId, tab\.frameSrc\)/,
    'readiness must be keyed by the frame src that proved it');
  assert.match(appSrc, /if \(relayReadyRef\.current\.get\(activeTab\.id\) === activeTab\.frameSrc\) return;/,
    'a tab whose frame already answered must not be probed again');
  assert.match(appSrc, /activeTab\?\.frameSrc, armRelayProbe/,
    'a changed frame src must re-run the probe decision');

  // A dead tab must not put its banner on a healthy one: the flag is per tab.
  assert.match(appSrc, /const relayUnrenderable = relayDeadTabs\.has\(activeTabId\)/,
    'the banner must be scoped to the tab that died');
});
