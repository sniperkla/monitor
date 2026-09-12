import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';

/**
 * The Local Relay's loopback web proxy — the in-app browser's client-side
 * renderer.
 *
 * Why it exists: the monitor server's `/api/browser/proxy` serves a stranger's
 * HTML from the MONITOR origin, which forces the frame to be sandboxed without
 * `allow-same-origin`. That gives the page an opaque origin, and an opaque
 * origin cannot use localStorage — measured: youtube.com paints its grey
 * skeleton and stops. Serving the same bytes from a loopback origin removes the
 * need for the sandbox, and the relay is the right host because the bytes then
 * never touch the monitor server.
 *
 * The relay source is not importable (it is a top-level script that dials a
 * server on load), so the proxy section is lifted out and EXECUTED against a
 * real HTTP server. Regex assertions alone would pass on a typo.
 */

const relay = readFileSync('public/local-relay.js', 'utf8');
const server = readFileSync('server.js', 'utf8');
const tokenRoute = readFileSync('src/app/api/relay/token/route.js', 'utf8');
const relayStatus = readFileSync('src/utils/relayStatus.js', 'utf8');

function section(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? src.indexOf(end, from) : src.length;
  assert.ok(to > from, `missing end marker after: ${start}`);
  return src.slice(from, to);
}

/** Boot the proxy straight out of the shipped source. */
function loadProxy() {
  const code = section(relay, 'const WEB_PROXY_PORT =', '// ── Main connection loop');
  const announced = [];
  const activeWs = {
    readyState: 1,
    send: (raw) => announced.push(JSON.parse(raw)),
  };
  const factory = new Function(
    'http',
    'activeWs',
    `${code}\n;return { startWebProxy, port: () => webProxyPort, encode: webProxyEncode, decode: webProxyDecode, close: () => { try { webProxyServer.close(); } catch (_) {} } };`
  );
  const mod = factory(http, activeWs);
  mod.startWebProxy();
  mod.announced = announced;
  return mod;
}

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function waitFor(fn, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out waiting for proxy to bind');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Minimal target site: HTML, an asset, a redirect, a cookie, and a JSON API. */
async function startTarget() {
  return listen((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><title>Target</title></head><body><a href="/next">next</a></body></html>');
      return;
    }
    if (url.pathname === '/cookie') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': 'sess=secret; Path=/',
      });
      res.end('<!doctype html><html><head></head><body>cookie page</body></html>');
      return;
    }
    if (url.pathname === '/redir') {
      res.writeHead(302, { location: '/final' });
      res.end();
      return;
    }
    if (url.pathname === '/final') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head></head><body>landed</body></html>');
      return;
    }
    if (url.pathname === '/api.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echoed: url.searchParams.get('q') }));
      return;
    }
    if (url.pathname === '/asset.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end('window.__asset = 1;');
      return;
    }
    if (url.pathname === '/deep/page.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><title>Deep</title></head><body>'
        + '<video src="clip.mp4"></video></body></html>');
      return;
    }
    if (url.pathname === '/deep/clip.mp4') {
      const body = Buffer.alloc(64, 7);
      res.writeHead(200, {
        'content-type': 'video/mp4',
        'accept-ranges': 'bytes',
        'content-length': String(body.length),
      });
      res.end(body);
      return;
    }
    if (url.pathname === '/slow.mp4') {
      // Deliberately dribbled out, so "did the proxy stream it?" is observable
      // rather than a claim about the source.
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '6' });
      res.write('abc');
      setTimeout(() => { res.write('def'); res.end(); }, 400);
      return;
    }
    if (url.pathname === '/drip.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      let n = 0;
      const timer = setInterval(() => {
        if (n++ >= 20) { clearInterval(timer); res.end(); return; }
        res.write(Buffer.alloc(1024, n));
      }, 60);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (url.pathname === '/zipped.json') {
      const raw = Buffer.from(JSON.stringify({ big: 'x'.repeat(5000) }));
      const gz = zlib.gzipSync(raw);
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(gz.length),
      });
      res.end(gz);
      return;
    }
    if (url.pathname === '/echo') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString('utf8') }));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('nope');
  });
}

const proxy = loadProxy();
const target = await startTarget();
const port = await waitFor(() => proxy.port());
const origin = `http://127.0.0.1:${port}`;
const targetOrigin = `http://127.0.0.1:${target.port}`;
const enc = proxy.encode(targetOrigin);
const proxyUrl = (pathAndQuery) => `${origin}/p/${enc}${pathAndQuery}`;

test.after(async () => {
  // Both listeners must be closed or the test process never exits — a
  // still-bound loopback server keeps the event loop alive forever.
  proxy.close();
  await new Promise((r) => target.srv.close(r));
});

// ── binding and announcement ────────────────────────────────────────────────

test('the relay announces the port it actually bound', () => {
  const ready = proxy.announced.filter((m) => m.type === 'webproxy:ready');
  assert.ok(ready.length >= 1, 'the relay must tell the server where the proxy landed');
  assert.equal(ready[0].port, port, 'the announced port must be the one really bound');
  // The requested port is only a hint: another listener may own it, so the real
  // one is reported. This is the same contract as the WebUI gateway.
  assert.match(relay, /webProxyPort \|\| null/, 'init must carry the port once known');
});

test('the server stores the announced port and exposes it to the client', () => {
  assert.match(server, /msg\.type === 'webproxy:ready'/, 'server must handle the announcement');
  assert.match(server, /entry\.webProxyPort = port/, 'server must store it on the relay record');
  assert.match(tokenRoute, /webProxyPort: Number\(relay\.webProxyPort\)/, 'the status route must expose it');
  assert.match(relayStatus, /webProxyPort/, 'the client helper must pass it through');
});

// ── forwarding ──────────────────────────────────────────────────────────────

test('a page is fetched from the target and framed through the proxy path', async () => {
  const res = await fetch(proxyUrl('/'));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Target/, 'the target body must come through');
  // The base must point at the PROXY, not the target. That is what makes every
  // relative link, asset and fetch come back here — and what removes the need
  // for click interception entirely.
  assert.ok(
    html.includes(`<base href="${origin}/p/${enc}/">`),
    'base href must be the proxy path so relative URLs stay proxied'
  );
  assert.match(html, /__mpProxy:'ready'/, 'the ready beacon must be injected');
});

test('relative subresources and API calls are forwarded, not redirected to the target', async () => {
  // This is the case the server-side sandboxed proxy could never do: the page's
  // own relative fetch lands on the proxy and is forwarded same-origin, so it
  // needs no CORS header from the target.
  const api = await fetch(proxyUrl('/api.json?q=hello'));
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), { ok: true, echoed: 'hello' });

  const asset = await fetch(proxyUrl('/asset.js'));
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') || '', /javascript/);
  assert.equal(await asset.text(), 'window.__asset = 1;');
});

test('POST bodies are forwarded', async () => {
  const res = await fetch(proxyUrl('/echo'), {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'payload',
  });
  assert.deepEqual(await res.json(), { method: 'POST', body: 'payload' });
});

test('a redirect moves the base to where the page actually landed', async () => {
  // `http://youtube.com` → `https://www.youtube.com` is the everyday case: if
  // the base stayed on the pre-redirect origin every relative asset would
  // resolve to the wrong host.
  const res = await fetch(proxyUrl('/redir'));
  const html = await res.text();
  assert.match(html, /landed/, 'the redirect must be followed');
  assert.ok(
    html.includes(`<base href="${origin}/p/${enc}/">`),
    'base must reflect the final origin, not the requested one'
  );
});

test('a page below the root keeps its directory, so document-relative media resolves', async () => {
  // `<base href>` OVERRIDES the document URL for relative resolution, so an
  // origin-only base does not merely fail to help — it breaks what would
  // otherwise have worked, because the document URL already carries the right
  // path. Measured against a real page at `/html/html5_video.asp` whose
  // `<video>` used the relative `mov_bbb.mp4`: the base sent it to
  // `/mov_bbb.mp4` upstream, a 404, and the media element ended
  // `NETWORK_NO_SOURCE` with `readyState: 0`. Root-absolute URLs are unaffected
  // either way, which is why the breakage stayed invisible.
  const res = await fetch(proxyUrl('/deep/page.html'));
  const html = await res.text();
  assert.ok(
    html.includes(`<base href="${origin}/p/${enc}/deep/">`),
    'base must carry the document directory, not just the origin'
  );

  // And the URL that base produces must actually resolve upstream — the
  // assertion above is about the string, this one is about the effect.
  const media = await fetch(proxyUrl('/deep/clip.mp4'));
  assert.equal(media.status, 200, 'the relative media URL must resolve to the real path');
  assert.match(media.headers.get('content-type') || '', /video\/mp4/);

  // The root case must NOT gain a spurious directory.
  const root = await fetch(proxyUrl('/'));
  assert.ok(
    (await root.text()).includes(`<base href="${origin}/p/${enc}/">`),
    'a root page keeps a root base'
  );
});

// ── the headers that decide whether the frame renders at all ────────────────

test('the document carries the COEP/CORP pair a cross-origin frame needs', async () => {
  const res = await fetch(proxyUrl('/'));
  // Without COEP the nested document is refused outright
  // (`coep-frame-resource-needs-coep-header`); without an explicit CORP, COEP
  // makes the default `same-origin` and a CROSS-origin frame is refused with
  // `corp-not-same-origin-after-defaulted-to-same-origin-by-coep`. Both were
  // measured — see MEMORY.md. A same-origin proxy never hits either.
  assert.equal(res.headers.get('cross-origin-embedder-policy'), 'credentialless');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  // The target must not be able to opt itself out of being framed here, and
  // must not impose its CSP on our frame.
  assert.equal(res.headers.get('x-frame-options'), null);
  assert.equal(res.headers.get('content-security-policy'), null);
});

test('upstream cookies are stripped in both directions', async () => {
  // The frame's cookie jar is 127.0.0.1:<port>, shared by EVERY proxied site on
  // this listener. Forwarding one site's cookie upstream, or storing the
  // target's cookie there, would leak sessions across sites.
  const res = await fetch(proxyUrl('/cookie'));
  const setCookie = res.headers.get('set-cookie') || '';
  assert.doesNotMatch(setCookie, /sess=secret/, 'the target Set-Cookie must not reach the frame');
  // Our own cookie is expected — it is what makes un-prefixed navigation work.
  assert.match(setCookie, /mp_proxy_target=/, 'the listener may set only its own target cookie');
  assert.match(await res.text(), /cookie page/);
});

test('an un-prefixed path is sent back through the proxy, not to the info page', async () => {
  // `location.href = '/watch'` resolves against the DOCUMENT url, not against
  // <base href>, so a page at /p/<enc>/ lands its root-absolute navigations on
  // this listener's root. Google does exactly this for /xjs/, /gen_204 and
  // /complete/s, and without the re-prefix every one of them would hit the
  // informational page instead of the site.
  //
  // An earlier version of this comment blamed this re-prefix for youtube.com
  // failing in a frame. Both halves of that were wrong: the re-prefix works
  // (measured, 12 redirects on a single Google load) and YouTube renders
  // (measured — scratch/yt-actual-content.mjs).
  const first = await fetch(proxyUrl('/'));
  const cookie = (first.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^mp_proxy_target=/, 'loading a page must remember its target');

  const res = await fetch(`${origin}/watch?v=1`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = res.headers.get('location') || '';
  assert.equal(location, `/p/${enc}/watch?v=1`, 'the path must be re-prefixed with the remembered target');

  // And a connection with NOTHING remembered still gets the informational
  // page. undici pools connections, so a plain fetch would hit the SAME
  // stamped socket and be repaired (that is the socket source below) — use a
  // one-shot Connection: close request to prove the fallback still exists.
  const bare = await new Promise((resolve) => {
    import('node:net').then(({ default: net }) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write(`GET /watch HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      });
      let buf = '';
      sock.on('data', (d) => { buf += d.toString(); });
      sock.on('close', () => {
        const status = Number((/^HTTP\/1\.[01] (\d+)/.exec(buf) || [])[1]);
        resolve({ status, body: buf });
      });
    });
  });
  assert.equal(bare.status, 200);
  assert.match(bare.body, /Relay web proxy is running/);

  // Conversely, the SAME pooled connection (stamped by the first /p/ load)
  // now repairs an un-prefixed path even with NO cookie and NO referer —
  // the third source that fixed the Google-search info page.
  const viaSocket = await fetch(`${origin}/watch`, { redirect: 'manual' });
  assert.equal(viaSocket.status, 302);
  assert.equal(viaSocket.headers.get('location'), `/p/${enc}/watch`);
});

test('a decompressed body is not mislabelled by a stale content-length', async () => {
  const res = await fetch(proxyUrl('/'));
  const body = await res.text();
  // fetch() decompresses, so the upstream length is wrong for these bytes. A
  // stale value truncates the document and the page renders half-parsed.
  assert.equal(Number(res.headers.get('content-length')), Buffer.byteLength(body));
});

test('a media body reaches the client before upstream has finished sending it', async () => {
  // The point of not buffering. A `<video>` opens with `Range: bytes=0-`, which
  // a range-capable origin answers with the WHOLE file in one 206 — so with the
  // old `await upstream.arrayBuffer()` the response did not even resolve until
  // upstream had closed, i.e. the player waited for the entire video before it
  // could start. This asserts the first bytes arrive on their own.
  const started = Date.now();
  const res = await fetch(proxyUrl('/slow.mp4'));
  const reader = res.body.getReader();

  const first = await reader.read();
  const elapsed = Date.now() - started;
  assert.equal(Buffer.from(first.value).toString('utf8'), 'abc',
    'the first half must arrive on its own');
  assert.ok(elapsed < 300,
    `the first chunk must arrive before upstream finishes (took ${elapsed}ms)`);

  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += Buffer.from(value).toString('utf8');
  }
  assert.equal(rest, 'def', 'the remainder must still arrive');
});

test('a decoded body never carries the compressed length', async () => {
  // undici decodes gzip transparently but leaves `content-encoding` and the
  // COMPRESSED `content-length` in place, so forwarding that length would
  // truncate the body. Streaming therefore forwards a length only when nothing
  // was decoded, and omits it otherwise.
  const res = await fetch(proxyUrl('/zipped.json'));
  const body = await res.text();
  assert.equal(JSON.parse(body).big.length, 5000, 'the decoded body must be complete');
  const len = res.headers.get('content-length');
  if (len !== null) {
    assert.equal(Number(len), Buffer.byteLength(body),
      'a length, when sent, must describe the decoded body');
  }
});

test('a frame that walks away mid-body does not take the proxy down', async () => {
  // A player abandons a range request on every seek, so this is the everyday
  // case, not an edge one. Cancelling the body stream from inside the iteration
  // throws `ERR_INVALID_STATE: ReadableStream is locked`, and because it is
  // thrown inside a 'close' listener it is not caught by the loop's try — it
  // took the whole relay process down. Aborting the fetch signal is the
  // mechanism that works.
  const ac = new AbortController();
  const res = await fetch(proxyUrl('/drip.mp4'), { signal: ac.signal });
  const reader = res.body.getReader();
  await reader.read();
  ac.abort();
  await new Promise((r) => setTimeout(r, 200));

  // The proxy must still be alive and serving.
  const after = await fetch(proxyUrl('/asset.js'));
  assert.equal(after.status, 200, 'the proxy must survive a client that walks away');
  assert.equal(await after.text(), 'window.__asset = 1;');
});

// ── control endpoints ───────────────────────────────────────────────────────

test('a preflight is answered with allow-private-network', async () => {
  // The monitor app is a PUBLIC https origin talking to a loopback listener, so
  // Chrome can send a Local/Private Network Access preflight. Forwarding it
  // upstream can never add the required header, and the frame is blocked before
  // it loads. The WebUI gateway answers the same way for the same reason.
  const res = await fetch(`${origin}/p/${enc}/`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
});

test('the ping endpoint answers without touching the network', async () => {
  const res = await fetch(`${origin}/__web_proxy_ping`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'pong');
});

test('a request with no target gets an explanation, not a crash', async () => {
  // With the keep-alive socket repair (below), an undici-pooled connection is
  // stamped by every earlier /p/ fetch and the un-prefixed root is repaired
  // instead of explained — so this must ask on a one-shot connection that no
  // /p/ response has ever stamped.
  const res = await new Promise((resolve) => {
    import('node:net').then(({ default: net }) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      });
      let buf = '';
      sock.on('data', (d) => { buf += d.toString(); });
      sock.on('close', () => {
        const status = Number((/^HTTP\/1\.[01] (\d+)/.exec(buf) || [])[1]);
        resolve({ status, body: buf });
      });
    });
  });
  assert.equal(res.status, 200);
  assert.match(res.body, /Relay web proxy is running/);
});

test('a non-http target is refused', async () => {
  const res = await fetch(`${origin}/p/${proxy.encode('file:///etc/passwd')}/`);
  assert.equal(res.status, 400);
});

// ── the codegen trap this codebase keeps walking into ───────────────────────

test('the injected script survives being a template literal', async () => {
  // A backtick inside the injected script terminates the enclosing template
  // literal early, leaving the rest of the file as top-level garbage. It has
  // happened twice in this repo. Assert against what is actually SERVED, not
  // against the source text — the source legitimately contains backticks as
  // concatenation delimiters, so a source regex checks the wrong thing.
  const html = await (await fetch(proxyUrl('/'))).text();
  const open = html.indexOf('<script>');
  const close = html.indexOf('</script>', open);
  assert.ok(open >= 0 && close > open, 'the injected script must be present');
  const script = html.slice(open + '<script>'.length, close);
  assert.doesNotMatch(script, /`/, 'no backticks may reach the injected script');
  // Truncation is the visible symptom of the trap: the literal ends early, so
  // the script is cut off mid-statement. The last statement must be intact.
  assert.match(script, /\}\)\(\)$/, 'the injected script must run to its end');
});

test('the injected script heartbeats, so a replaced document is detectable', async () => {
  // 'ready' only proves the document PARSED. A page whose own JS then navigates
  // to an origin that refuses framing leaves the frame on a chrome-error
  // document, and a cross-origin frame gives the parent no other signal — the
  // interval dies with the document, so the heartbeat STOPPING is the signal.
  //
  // Measured: youtube.com does NOT do this (it renders — see
  // scratch/yt-actual-content.mjs). The net is for the failure mode, not for
  // that site; an earlier version of this comment wrongly blamed YouTube, which
  // is exactly the kind of stale rationale that misleads the next reader.
  const html = await (await fetch(proxyUrl('/'))).text();
  const open = html.indexOf('<script>');
  const close = html.indexOf('</script>', open);
  const script = html.slice(open + '<script>'.length, close);
  assert.match(script, /setInterval\(/, 'the heartbeat must be on an interval, not a one-shot');
  assert.match(script, /__mpProxy:'alive'/, 'and it must post the alive marker');
  assert.match(script, /__mpProxy:'ready'/, 'ready is still what proves the document parsed');
});

test('absolute links are handed to the parent before they escape the relay', async () => {
  const html = await (await fetch(proxyUrl('/'))).text();
  const open = html.indexOf('<script>');
  const close = html.indexOf('</script>', open);
  const script = html.slice(open + '<script>'.length, close);
  assert.match(script, /u\.origin===location\.origin/, 'same-origin proxy links must be left alone');
  assert.match(script, /e\.preventDefault\(\)/, 'an escaping click must be stopped');
  assert.match(script, /__mpBrowser:.*?goto/, 'the parent must receive a navigation command');
  assert.match(script, /a\.target==='_blank'/, 'new-tab links must stay new tabs');
  assert.match(script, /parent===window/, 'top-level relay pages must not swallow clicks');
  assert.match(script, /Location\.prototype\.assign/, 'programmatic assign navigation must stay in the relay');
  assert.match(script, /Location\.prototype\.replace/, 'programmatic replace navigation must stay in the relay');
  assert.match(script, /window\.open=function/, 'window.open navigation must stay in the relay');

  const app = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  assert.match(app, /data\[WEB_FRAME_MSG\] === 'goto'/, 'the app must consume the relay command');
  assert.match(app, /relayProxyTargetFor\(parsed\.href, relayProxyPort\)/, 'already-proxied URLs must be unwrapped');
  assert.match(app, /relayUnprefixedTargetFor\(parsed\.href, relayProxyPort/, 'un-prefixed relay form navigations must be reattached to the current target');
});

test('the browser app watches the heartbeat and offers a real-tab escape hatch', () => {
  // The other half of the contract: without a watchdog the heartbeat is
  // pointless, and without the escape hatch a site that cannot be embedded
  // leaves a dead frame the user cannot act on.
  const app = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  assert.match(app, /RELAY_ALIVE_TIMEOUT_MS\s*=\s*[\d_]+/, 'the watchdog needs a timeout');
  assert.match(app, /data\.__mpProxy === 'alive'/, 'the app must handle the alive marker');
  assert.match(app, /armRelayAlive/, 'and re-arm the watchdog from it');
  assert.match(app, /relayUnrenderable/, 'a collapsed page must surface state, not a blank frame');
  // It must be user-actionable, not merely informational: the banner itself has
  // to carry the real-tab action.
  assert.match(
    app,
    /relayUnrenderable &&[\s\S]{0,900}onClick=\{handleExternal\}/,
    'the banner must offer the real-tab action'
  );

  // Backward compatibility, and the reason this is subtle: a relay built before
  // heartbeats existed still renders pages perfectly and never sends one. If
  // the watchdog were armed by 'ready', every such relay would be accused of a
  // dead page 8s in. Only a heartbeat that STOPS is evidence.
  const readyBranch = app.match(/__mpProxy === 'ready'\) \{([\s\S]*?)return;/);
  assert.ok(readyBranch, "the ready branch must exist");
  assert.doesNotMatch(readyBranch[1], /armRelayAlive/,
    'ready must NOT arm the heartbeat watchdog — an old relay would false-positive');
  const aliveBranch = app.match(/__mpProxy === 'alive'\) \{([\s\S]*?)return;/);
  assert.ok(aliveBranch, "the alive branch must exist");
  assert.match(aliveBranch[1], /armRelayAlive/, 'the first heartbeat is what arms the watchdog');
});

test('a dead relay frame recovers itself instead of stranding the user on a chrome-error', () => {
  // Measured in the wild (2026-09-12): the relay process restarted while the
  // user's frame was following a search redirect. The redirect landed in the
  // restart gap, the connection was refused, and the frame became a Chrome
  // error page. NOTHING could then reach it: the Reload button posted
  // __mpProxyCmd into a document that has no script, the banner only offered
  // "Open in Tab", and the tab sat on "127.0.0.1 refused to connect" until the
  // user reloaded the whole app. Recovery must be parent-driven.
  const app = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

  // The recovery primitive exists and is parent-driven: re-read the port, then
  // rebuild the frame from the tab's REAL url (the held frameSrc is stale —
  // the death came from a navigation we never saw).
  assert.match(app, /const recoverRelayTab = useCallback/, 'a recovery primitive must exist');
  const recoverDecl = app.indexOf('const recoverRelayTab = useCallback((tabId) => {');
  const recoverEnd = app.indexOf('}, [markRelayDead, refreshRelayPort, webTabFrame]);', recoverDecl);
  assert.ok(recoverDecl >= 0 && recoverEnd > recoverDecl, 'recoverRelayTab must be readable');
  const recover = recoverDecl >= 0 ? app.slice(recoverDecl, recoverEnd) : '';
  assert.match(recover, /refreshRelayPort\(\)/, 'recovery must re-read the port first — a re-bound relay is the common cause');
  assert.match(recover, /webTabFrame\(t\.url\)/, 'recovery must rebuild from the real target url, not the stale frameSrc');
  assert.match(recover, /if \(movedTo > 0\) return;/,
    'recovery must NOT rebuild when refreshRelayPort re-pointed the tabs itself — the render-closure webTabFrame still holds the old port');

  // Bounded: a site that dies on every load must not reload forever.
  assert.match(recover, /attempts >= 2/, 'auto-recovery must be bounded (no infinite reload loop)');
  const readyBranch = app.match(/__mpProxy === 'ready'\) \{([\s\S]*?)return;/);
  assert.ok(readyBranch, 'the ready branch must exist');
  assert.match(readyBranch[1], /relayRecoveryRef\.current\.delete\(tabId\)/,
    'a successful load must restore the full recovery budget');

  // The watchdog (the only signal a chrome-error frame gives) must recover the
  // ACTIVE tab automatically. A background tab must only get the banner: its
  // heartbeat may merely be timer-throttled, and reloading it would destroy a
  // working page.
  const aliveDecl = app.indexOf('const armRelayAlive = useCallback((tabId) => {');
  const aliveEnd = app.indexOf('}, [activeTabId, markRelayDead, recoverRelayTab]);', aliveDecl);
  assert.ok(aliveDecl >= 0 && aliveEnd > aliveDecl, 'armRelayAlive must be readable');
  const alive = aliveDecl >= 0 ? app.slice(aliveDecl, aliveEnd) : '';
  assert.ok(alive, 'armRelayAlive must be readable');
  assert.match(alive, /tabId === activeTabId[\s\S]*?recoverRelayTab\(tabId\)/,
    'a dead ACTIVE frame must auto-recover');
  assert.match(alive, /markRelayDead\(tabId, true\)/, 'a dead background frame must still surface the banner');

  // Declaration order (TDZ): recoverRelayTab is referenced by armRelayAlive,
  // which is itself referenced from the message effect.
  assert.ok(recoverDecl >= 0 && aliveDecl > recoverDecl,
    'recoverRelayTab must be declared before armRelayAlive uses it');

  // The Reload button must not post into a chrome-error document — that is the
  // silent no-op the user experienced. A dead relay tab goes through recovery,
  // and a LIVE relay tab is reloaded by the PARENT (src reassignment), because
  // every in-frame postMessage is a cross-origin ask that no-ops silently
  // whenever the injected script is not there to receive it.
  const reload = app.match(/const handleReload = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(reload, 'handleReload must be readable');
  const deadFirst = reload[1].indexOf('relayDeadTabs.has(activeTab.id)');
  const recoverCall = reload[1].indexOf('recoverRelayTab(activeTab.id)');
  const parentReload = reload[1].indexOf('frameRef.current.src = activeTab.frameSrc');
  assert.ok(deadFirst >= 0 && recoverCall >= 0, 'Reload must route a dead relay tab through recovery');
  assert.ok(deadFirst < parentReload, 'the dead-frame branch must come BEFORE the live reload');
  assert.ok(recoverCall < parentReload, 'recovery must be invoked, not the void postMessage');
  assert.doesNotMatch(app, /commandRelayFrame/,
    'no in-frame postMessage commands may remain — they are silent no-ops on a dead document');

  // The banner must offer a working in-app Retry, not only the external escape.
  assert.match(
    app,
    /relayUnrenderable &&[\s\S]{0,1100}onClick=\{\(\) => recoverRelayTab\(activeTabId\)\}/,
    'the banner must offer the in-app recovery action'
  );
});

test('the relay clock helpers are declared before anything that references them', () => {
  // Learned the hard way: `clearRelayClocks` is a `const`, and an effect ABOVE
  // its declaration that named it in a dependency array threw
  //   ReferenceError: Cannot access 'clearRelayClocks' before initialization
  // — a temporal-dead-zone error that broke the component on mount while all
  // 511 tests passed, because every one of them inspects source TEXT and none
  // of them runs the component. Declaration order is the cheap thing that CAN
  // be asserted, so assert it.
  const app = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');
  const decl = app.indexOf('const clearRelayClocks = useCallback');
  const use = app.indexOf('useEffect(() => () => clearRelayClocks()');
  assert.ok(decl >= 0, 'clearRelayClocks must be defined');
  assert.ok(use >= 0, 'and used by the unmount cleanup');
  assert.ok(decl < use, 'the declaration must come first, or the component throws on mount');

  // Same rule for the two clock-armers: both are referenced from effects.
  for (const name of ['armRelayProbe', 'armRelayAlive']) {
    const d = app.indexOf(`const ${name} = useCallback`);
    assert.ok(d >= 0, `${name} must be defined`);
    assert.ok(d < use, `${name} must be declared before the cleanup that uses it`);
  }
});


test("every frame-document response carries COEP+CORP, not just /p/ HTML", () => {
  // Measured 2026-09-12: the app shell embeds the relay with COEP
  // credentialless. A root-relative link click navigates the frame NATIVELY to
  // the un-prefixed origin path; that 302 repair response carried no CORP, and
  // Chromium refused the FOLLOW-UP /p/ document with
  // corp-not-same-origin-after-defaulted-to-same-origin-by-coep even though it
  // was served correctly. Every response that can BECOME the frame document
  // must declare both headers explicitly.
  const relay = readFileSync('public/local-relay.js', 'utf8');

  // The shared constant names both headers with the strict values.
  const kh = relay.indexOf('WEB_PROXY_FRAME_HEADERS = {');
  assert.ok(kh >= 0, 'the shared frame-header constant must exist');
  assert.match(relay.slice(kh, kh + 300), /credentialless/, 'COEP must be declared');
  assert.match(relay.slice(kh, kh + 300), /cross-origin/, 'CORP must be declared');

  // The un-prefixed 302 repair (the measured case) must spread it.
  const un = relay.indexOf('302, { location: back');
  assert.ok(un >= 0, 'the repair 302 must exist');
  assert.match(relay.slice(un, un + 160), /WEB_PROXY_FRAME_HEADERS/,
    'the repair 302 must carry the frame headers');

  // The informational un-prefixed page too (it can be navigated to directly).
  // Its writeHead carries the constant; the body then ends the index HTML.
  const infoPage = relay.indexOf('res.end(webProxyIndexHtml(proxyOrigin));');
  assert.ok(infoPage >= 0, 'the info page must exist');
  assert.match(relay.slice(infoPage - 220, infoPage), /WEB_PROXY_FRAME_HEADERS/,
    'the info page must carry the frame headers');

  // The /p/ HTML branch must use the same constant (not drift apart).
  const b = relay.indexOf('Object.assign(outHeaders, WEB_PROXY_FRAME_HEADERS)');
  assert.ok(b >= 0, 'the /p/ HTML branch must use the shared constant');

  // The proxy error page can become a frame document when the origin fails.
  const e = relay.indexOf("502, { 'content-type': 'text/html");
  assert.ok(e >= 0, 'the 502 page must exist');
  assert.match(relay.slice(e, e + 120), /WEB_PROXY_FRAME_HEADERS/, 'the 502 page must carry the frame headers');
});

test('the search GET survives JS form.submit() and a blocked cookie', () => {
  // Measured 2026-09-12: Google's search box calls form.submit(), which fires
  // NO submit event, so the event bridge never saw it; the GET escaped natively
  // to the un-prefixed relay root, and with third-party cookies blocked AND an
  // origin-only referer the relay could not repair it — the user got the
  // "Relay web proxy is running" info page instead of search results.
  const relay = readFileSync('public/local-relay.js', 'utf8');

  // 1. form.submit() must be patched to route GET forms through the parent.
  assert.match(relay, /HTMLFormElement\.prototype\.submit/, 'form.submit must be patched in the injected bridge');
  const patch = relay.indexOf('__mpOrigSubmit');
  assert.ok(patch >= 0, 'the native method must be preserved for non-GET forms');
  assert.match(relay.slice(patch, patch + 700), /parent===window/, 'a top-level page must keep the native submit');

  // 2. the keep-alive socket is a third repair source: every /p/ response
  //    stamps the connection, and the un-prefixed branch reads it last.
  assert.match(relay, /req\.socket\?\.____mpLastTarget/, 'the repair must read the socket stamp');
  const stamp = relay.indexOf('req.socket.____mpLastTarget = target.origin');
  assert.ok(stamp >= 0, 'every /p/ response must stamp the connection');

  // 3. a repair failure must say so — the info page used to be silent, which
  //    made this exact report undiagnosable from the log alone.
  assert.match(relay, /no target known/, 'repair failures must be logged');
});