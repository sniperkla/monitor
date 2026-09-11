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

test('ordinary external URLs open directly in a real browser tab', () => {
  const appSrc = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  assert.match(appSrc, /const openDirectWebsite = useCallback/);
  assert.match(appSrc, /window\.monitorDesktop/);
  assert.match(appSrc, /desktopApi\.openWebview\(\{ url: target/);
  assert.match(appSrc, /openExternalUrl\(target\)/);
  assert.match(appSrc, /test\(destinationUrl\)/);
  assert.match(appSrc, /openDirectWebsite\(destinationUrl\)/);
  assert.doesNotMatch(
    appSrc.match(/const navigateAddress = \(input\) => \{[\s\S]*?\n  \};/)[0],
    /proxyFrameUrl|setShowIframeNotice\(true\)/,
    'ordinary navigation must not route website content through the central proxy'
  );
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

  // Applied to external web only — the trusted agent Web UI needs same-origin.
  assert.match(
    appSrc,
    /sandbox=\{activeTab\?\.type === 'web' \? WEB_FRAME_SANDBOX : undefined\}/,
    'sandbox must be conditional on the external-web tab type'
  );
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
  assert.match(appSrc, /e\.source !== frameRef\.current\?\.contentWindow/,
    'the message handler must check event.source so another window cannot drive the tab');
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
  assert.match(appSrc, /frameSrc: proxyUrlFor\(href\)/, 'the new tab must go through the proxy');
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
