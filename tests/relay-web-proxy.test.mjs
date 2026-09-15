import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

// Keep the per-site origin registry out of the developer's home directory, and
// the site listeners out of the port range a real relay is using right now.
const REGISTRY = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-origins-')), 'origins.json');
process.env.SSH_MONITOR_RELAY_ORIGINS = REGISTRY;
process.env.SSH_MONITOR_RELAY_SITE_PORT_BASE = '19400';

const relay = readFileSync('public/local-relay.js', 'utf8');
const server = readFileSync('server.js', 'utf8');
const tokenRoute = readFileSync('src/app/api/relay/token/route.js', 'utf8');
const relayStatus = readFileSync('src/utils/relayStatus.js', 'utf8');
const browserApp = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

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
    'https',
    'fs',
    'path',
    'os',
    'activeWs',
    `${code}\n;return { startWebProxy, port: () => webProxyPort, encode: webProxyEncode, decode: webProxyDecode, stealth: STEALTH_SCRIPT, sites: () => webProxySites, ensureSite: ensureSiteListener, originForPort: webProxyOriginForPort, upgradeTarget: webProxyUpgradeTarget, registryPath: WEB_PROXY_SITE_REGISTRY, close: () => { try { webProxyServer.close(); webProxyServer.closeAllConnections?.(); } catch (_) {} for (const e of webProxySites.values()) { try { e.server?.close(); e.server?.closeAllConnections?.(); } catch (_) {} } } };`
  );
  const mod = factory(http, https, fs, path, os, activeWs);
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
    if (url.pathname === '/xredir') {
      // Cross-ORIGIN: the frame must end up on the other origin's own
      // listener, not stay here wearing this site's origin.
      res.writeHead(302, { location: `${elsewhereBase}/landed` });
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

// `/xredir` must point at a DIFFERENT origin, and that origin's port is not
// known when the handler is written — so it is read from here at request time.
// Declared before the fixtures below, which are top-level awaits.
let elsewhereBase = '';

const proxy = loadProxy();
const target = await startTarget();
const elsewhere = await startElsewhere();
const socketTarget = await startSocketTarget();
elsewhereBase = elsewhere.base;
const port = await waitFor(() => proxy.port());
const origin = `http://127.0.0.1:${port}`;
const targetOrigin = `http://127.0.0.1:${target.port}`;
const enc = proxy.encode(targetOrigin);
const proxyUrl = (pathAndQuery) => `${origin}/p/${enc}${pathAndQuery}`;

// ── fixtures for the per-site origin tests ──────────────────────────────────

/** A second site, so "two sites get two origins" can be measured, not assumed. */
async function startElsewhere() {
  const s = await listen((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Elsewhere</title></head><body>landed elsewhere ${url.pathname}</body></html>`);
  });
  s.base = `http://127.0.0.1:${s.port}`;
  return s;
}

/** A target that speaks WebSocket, so the tunnel can be exercised for real. */
async function startSocketTarget() {
  const s = await listen((req, res) => {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('no http here');
  });
  s.srv.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'] || '';
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    // Echo. If both directions are piped, whatever the client sends comes back.
    socket.on('data', (chunk) => { try { socket.write(chunk); } catch (_) {} });
  });
  s.base = `http://127.0.0.1:${s.port}`;
  return s;
}

/**
 * Resolve a target to the loopback ORIGIN the relay serves it from, by taking
 * the entry listener's 307 rather than guessing a port.
 */
async function siteOriginFor(target) {
  const res = await fetch(`${origin}/go/${proxy.encode(new URL(target).origin)}/`, { redirect: 'manual' });
  assert.equal(res.status, 307, 'the entry listener must redirect, not serve');
  const loc = res.headers.get('location');
  assert.ok(loc, 'the redirect must name the site origin');
  return new URL(loc).origin;
}

/** A raw WebSocket handshake, so nothing about it is mocked. */
function rawUpgrade(base, pathname) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n`
        + 'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
        + 'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    let buf = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) {}
      reject(new Error(`upgrade timed out; got ${JSON.stringify(buf.slice(0, 120))}`));
    }, 5000);
    sock.on('error', (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    });
    sock.on('data', (chunk) => {
      if (done) return;
      buf += chunk.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      if (buf.startsWith('HTTP/1.1 101')) {
        // Handshake accepted — now prove the tunnel carries bytes both ways.
        if (buf.length <= buf.indexOf('\r\n\r\n') + 4) { sock.write('ping'); return; }
      }
      done = true;
      clearTimeout(timer);
      const head = buf.slice(0, buf.indexOf('\r\n\r\n'));
      const body = buf.slice(buf.indexOf('\r\n\r\n') + 4);
      try { sock.destroy(); } catch (_) {}
      resolve({ statusLine: head.split('\r\n')[0], body });
    });
    // Fallback: the echo may arrive in the same tick as the handshake.
    sock.on('close', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const at = buf.indexOf('\r\n\r\n');
      resolve({
        statusLine: at >= 0 ? buf.slice(0, at).split('\r\n')[0] : '',
        body: at >= 0 ? buf.slice(at + 4) : buf,
      });
    });
  });
}

test.after(async () => {
  // Both listeners must be closed or the test process never exits — a
  // still-bound loopback server keeps the event loop alive forever.
  //
  // `close()` alone is NOT enough, and the suite hung for three minutes because
  // of it: `close()` waits for open connections to end, and `fetch` (undici)
  // pools keep-alive sockets, so it can wait a very long time for a socket
  // nobody is using. `closeAllConnections()` ends them outright. The timeout is
  // a floor, not the mechanism — a listener that still refuses to close must
  // not be able to hang the whole run.
  const shutdown = (srv) => new Promise((resolve) => {
    if (!srv) { resolve(); return; }
    try { srv.closeAllConnections?.(); } catch (_) { /* not listening */ }
    const done = setTimeout(resolve, 1000);
    try { srv.close(() => { clearTimeout(done); resolve(); }); } catch (_) { clearTimeout(done); resolve(); }
  });
  proxy.close();
  await Promise.all([
    shutdown(target.srv),
    shutdown(elsewhere?.srv),
    shutdown(socketTarget?.srv),
  ]);
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

test('an un-prefixed path is served back through the proxy directly (no 302)', async () => {
  const first = await fetch(proxyUrl('/'));
  const cookie = (first.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^mp_proxy_target=/, 'loading a page must remember its target');

  // The repair serves the target DIRECTLY (internal re-dispatch, 200)
  // instead of 302-ing: a 302 is fatal for script subresources under the
  // app shell's COEP ("The script resource is behind a redirect, which is
  // disallowed" — measured 2026-09-12: a video site's
  // /generated-service_worker.js took the 302 and the player never
  // booted). The response must be the SITE's content served through the
  // relay, not a redirect and not the info page.
  const res = await fetch(`${origin}/watch?v=1`, { headers: { cookie }, redirect: 'manual' });
  assert.notEqual(res.status, 302, 'no redirect — served directly');
  assert.doesNotMatch(await res.text(), /Relay web proxy is running/, 'not the info page');

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
  // the third source that fixed the Google-search info page. The repaired
  // response serves the site's content directly (no redirect in the chain).
  const viaSocket = await fetch(`${origin}/watch`, { redirect: 'manual' });
  assert.notEqual(viaSocket.status, 302, 'socket-stamped repair serves directly');
  assert.equal(viaSocket.headers.get('location'), null, 'no redirect issued');
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
  assert.equal(res.status, 200);
  assert.match(res.body, /Relay web proxy is running/);
});

test('a non-http target is refused', async () => {
  const res = await fetch(`${origin}/p/${proxy.encode('file:///etc/passwd')}/`);
  assert.equal(res.status, 400);
});

// ── the codegen trap this codebase keeps walking into ───────────────────────

/**
 * The BRIDGE, not "the first <script> in the document".
 *
 * `indexOf('<script>')` was the old way to find it, and it broke the moment the
 * relay started injecting a stealth script AHEAD of the bridge: every assertion
 * below silently began checking the wrong script. Anchored on the `post`
 * definition, which only the bridge has, so the next injected script cannot
 * shadow it again.
 *
 * The anchor is deliberately NOT glued to `(function(){`: the bridge has grown
 * a preamble (the document's real URL, which the parent needs to name the site
 * rather than a loopback port) and will grow again. Scanning BACK from the
 * marker to the opening tag survives that; requiring them to be adjacent does
 * not, and it failed exactly that way when the preamble was added.
 */
function bridgeIn(html) {
  const marker = html.indexOf('function post(m){try{parent.postMessage');
  assert.ok(marker >= 0, 'the injected bridge must be present in the document');
  const open = html.lastIndexOf('<script>(function(){', marker);
  assert.ok(open >= 0, 'the bridge must sit inside its own script tag');
  const close = html.indexOf('</script>', marker);
  assert.ok(close > open, 'the bridge script tag must be closed');
  return html.slice(open + '<script>'.length, close);
}

test('the injected script survives being a template literal', async () => {
  // A backtick inside the injected script terminates the enclosing template
  // literal early, leaving the rest of the file as top-level garbage. It has
  // happened twice in this repo. Assert against what is actually SERVED, not
  // against the source text — the source legitimately contains backticks as
  // concatenation delimiters, so a source regex checks the wrong thing.
  const html = await (await fetch(proxyUrl('/'))).text();
  const script = bridgeIn(html);
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
  const script = bridgeIn(html);
  assert.match(script, /setInterval\(/, 'the heartbeat must be on an interval, not a one-shot');
  assert.match(script, /__mpProxy:'alive'/, 'and it must post the alive marker');
  assert.match(script, /__mpProxy:'ready'/, 'ready is still what proves the document parsed');
});

test('absolute links are handed to the parent before they escape the relay', async () => {
  const html = await (await fetch(proxyUrl('/'))).text();
  const script = bridgeIn(html);
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

  // The un-prefixed repair now RE-DISPATCHES in place (no 302): a script
  // behind the repair 302 was refused wholesale under COEP. Pin the new
  // internal re-dispatch instead — it must keep the frame headers available
  // for the re-served response (the handler spreads them itself).
  const rd = relay.indexOf('return handleWebProxyHttp(req, res);');
  assert.ok(rd >= 0, 'the internal re-dispatch must exist');
  assert.match(relay.slice(rd - 200, rd), /req\.url = back/);

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

// ── stealth ─────────────────────────────────────────────────────────────────
// The relay is a Node fetch, not a browser: it sent no client hints at all, and
// the frame's JS still reported the USER's browser. Both halves are pinned
// here, because either one alone leaves the contradiction a bot wall reads.

/** A target that records what the proxy actually sent upstream. */
async function startEcho() {
  const seen = [];
  const { srv, port: p } = await listen((req, res) => {
    seen.push(req.headers);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head></head><body>echo</body></html>');
  });
  return {
    seen,
    base: `http://127.0.0.1:${p}`,
    close: () => new Promise((r) => srv.close(r)),
  };
}

test('a proxied request carries Chrome client hints, not a bare fetch', async () => {
  const echo = await startEcho();
  try {
    await fetch(`${origin}/p/${proxy.encode(echo.base)}/`, {
      headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9' },
    });
    const h = echo.seen.at(-1);
    assert.match(String(h['sec-ch-ua']), /Chromium/, 'no client hints at all is a cheap bot tell');
    assert.equal(h['sec-ch-ua-mobile'], '?0');
    assert.equal(h['sec-ch-ua-platform'], '"macOS"');
    assert.match(String(h['user-agent']), /Chrome\/140/, 'the UA the page is told must match the one sent');
  } finally {
    await echo.close();
  }
});

test('the fetch metadata never claims a navigation it cannot honour', async () => {
  // undici pins sec-fetch-mode to `cors` and the Fetch spec forbids setting any
  // sec- header, so a document navigation cannot be described honestly. The
  // rule is therefore: never send a combination a real browser cannot produce.
  // `dest: document` beside `mode: cors` is exactly that combination.
  const echo = await startEcho();
  try {
    for (const path of ['/', '/app.js']) {
      await fetch(`${origin}/p/${proxy.encode(echo.base)}${path}`, { headers: { accept: '*/*' } });
      const h = echo.seen.at(-1);
      assert.equal(h['sec-fetch-mode'], 'cors', 'undici forces this; assert it so a fix is noticed');
      assert.equal(h['sec-fetch-dest'], 'empty', 'must agree with the forced mode');
      assert.equal(h['sec-fetch-site'], 'same-origin', 'agrees with the origin-only referer');
      assert.equal(h['sec-fetch-user'], undefined, 'navigation-only header must not be faked');
      assert.equal(h['upgrade-insecure-requests'], undefined, 'navigation-only header must not be faked');
    }
  } finally {
    await echo.close();
  }
});

test('the injected stealth script parses and reports a non-automated navigator', () => {
  const script = proxy.stealth;
  assert.ok(script.startsWith('<script>') && script.endsWith('</script>'), 'must be a script tag');
  assert.ok(!script.includes('`'), 'a backtick would terminate the bridge template literal');
  const body = script.slice('<script>'.length, -'</script>'.length);

  // Deliberately bare: no WebGL, no window.chrome, no Notification. The script
  // must degrade to "not stealthy" rather than throw and take the page with it.
  const Navigator = function Navigator() {};
  const nav = { permissions: { query: () => Promise.resolve({ state: 'prompt' }) } };
  const win = {};
  new Function('Navigator', 'navigator', 'window', 'Notification', body)(Navigator, nav, win, undefined);

  // Reads the getter's VALUE — calling .get() here, so no extra () at the use site.
  const get = (p) => Object.getOwnPropertyDescriptor(Navigator.prototype, p).get();
  assert.equal(get('webdriver'), false, 'webdriver must read false');
  assert.match(get('userAgent'), /Chrome\/140\.0\.0\.0/, 'navigator UA must agree with the request');
  assert.equal(get('language'), 'en-US');
  assert.equal(get('platform'), 'MacIntel');
  assert.equal(get('plugins').length, 5, 'a plugin-less navigator is a classic automation tell');
  // Own functions, not the interface's: the inherited natives need an internal
  // slot this object does not have and would throw "Illegal invocation".
  assert.equal(typeof get('plugins').item, 'function', 'item() must be callable, not the native');
  assert.equal(get('plugins').item(0).name, 'PDF Viewer');
  assert.equal(get('plugins').item(99), null);
  // bot.sannysoft.com's rule, verbatim: instanceof PluginArray AND a non-empty
  // length AND plugins[0].toString() === '[object Plugin]'. Asserting the last
  // two here is what keeps a plain-object implementation from creeping back.
  assert.equal(get('plugins')[0].toString(), '[object Plugin]');
  assert.equal(get('plugins').toString(), '[object PluginArray]');
  assert.equal(get('mimeTypes')[0].toString(), '[object MimeType]');
  assert.equal(get('mimeTypes').length, 2);
  assert.equal(typeof get('mimeTypes').namedItem, 'function');
  assert.equal(get('userAgentData').platform, 'macOS');
  assert.equal(get('hardwareConcurrency'), 8);
  assert.equal(get('maxTouchPoints'), 0);
  assert.ok(win.chrome && win.chrome.runtime, 'window.chrome must exist');
});

test('the stealth script is injected ahead of any page script', async () => {
  const html = await (await fetch(proxyUrl('/'))).text();
  const stealthAt = html.indexOf('"webdriver"');
  const bridgeAt = html.indexOf('__mpProxy');
  assert.ok(stealthAt > 0, 'the stealth script must be in the document');
  assert.ok(stealthAt < bridgeAt, 'stealth must run before the bridge, and both before page code');
  assert.ok(html.includes('<base href='), 'the base tag must still come first');
});

// ── root-absolute refs are never rewritten, and the bridge must agree ───────
//
// The rule, learned the hard way on our own dashboard (2026-09-15): a
// root-absolute URL must survive the relay untouched, in the HTML AND in the
// injected bridge. `<base href>` does not apply to root-absolute paths, so
// `/_next/…` resolves against the relay's own root — which is fine, because the
// un-prefixed repair re-dispatches it internally and the browser sees one plain
// 200. There is nothing to fix up.
//
// Rewriting it is not merely redundant, it is fatal to any bundler app: the
// parser loads `<script src="/_next/…">`, and the bridge's src setters and
// MutationObserver re-point the SAME element at the prefixed spelling. Every
// chunk then loads twice under two URLs, the browser holds two module instances
// of each, `window.next` is never defined, and the page sits on its server-
// rendered "CONNECTING…" forever with every asset returning 200. Measured: 49
// requests and 0 API calls with the rewrite, 37 and 4 without it.

test('root-absolute refs in the HTML are left exactly as the target sent them', async () => {
  const { srv, port: p } = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head>'
      + '<script src="/_next/static/chunks/tag.js"></script>'
      + '<script>self.__next_f=self.__next_f||[];self.__next_f.push([1,{"c":["/_next/static/chunks/payload.js"]}])</script>'
      + '</head><body>x</body></html>');
  });
  try {
    const targetOrigin = `http://127.0.0.1:${p}`;
    const pref = `${origin}/p/${proxy.encode(targetOrigin)}`;
    const html = await (await fetch(`${pref}/`)).text();

    assert.ok(html.includes('src="/_next/static/chunks/tag.js"'),
      'the tag must keep the spelling the target used');
    assert.ok(html.includes('"/_next/static/chunks/payload.js"'),
      'and so must the inline flight payload — ONE spelling, or the module graph splits');

    // Nothing may acquire the prefix. Two spellings of the same chunk is the
    // exact failure this test exists to prevent.
    const prefixed = html.match(new RegExp(`${pref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/_next/`, 'g')) || [];
    assert.equal(prefixed.length, 0, `root-absolute refs were prefixed: ${prefixed.length}`);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

/**
 * Execute the bridge's `mpRewrite` — the URL decision that caused the split.
 *
 * The bridge is a top-level IIFE with no exports, so the served body is run in
 * a minimal fake DOM and the function is handed back through a probe hook. Most
 * of the bridge's hooks sit in `try {} catch {}` and simply no-op without their
 * interfaces, so `mpRewrite` is the part that actually gets exercised. This is
 * the only way to test a branch whose bug is invisible in the served text.
 */
function loadMpRewrite(html) {
  const body = bridgeIn(html);
  // `mpRewrite` is a local of the bridge's IIFE, so the probe hook has to run
  // INSIDE it — appended after the call it is out of scope.
  const cut = body.lastIndexOf('})()');
  assert.ok(cut > 0, 'the bridge must end with its IIFE call');
  const patched = body.slice(0, cut) + ';try{__mpProbe(mpRewrite)}catch(e){}' + body.slice(cut);

  const win = { fetch: () => {}, open: () => null };
  const doc = { baseURI: 'http://127.0.0.1:19999/p/ENC/', documentElement: null };
  const loc = {
    origin: 'http://127.0.0.1:19999',
    pathname: '/p/ENC/',
    protocol: 'http:',
    href: 'http://127.0.0.1:19999/p/ENC/',
  };
  const noop = () => {};
  let rewrite = null;
  const fn = new Function(
    'window', 'document', 'location', 'parent', 'addEventListener',
    'setInterval', 'clearInterval', 'MutationObserver', 'btoa', 'URL', 'history',
    '__mpProbe',
    patched
  );
  fn(win, doc, loc, win, noop, noop, noop, class { observe() {} }, btoa, URL, {}, (f) => { rewrite = f; });
  assert.equal(typeof rewrite, 'function', 'the bridge must expose mpRewrite to the probe');
  return rewrite;
}

test('the bridge leaves every same-origin URL alone, root-absolute included', async () => {
  const html = await (await fetch(proxyUrl('/'))).text();
  const rewrite = loadMpRewrite(html);
  const L = 'http://127.0.0.1:19999';

  // The regression. A root-absolute same-origin path is the single input that
  // used to be wrapped in the tunnel prefix, and it is what split the graph.
  assert.equal(rewrite('/_next/static/chunks/tag.js'), '/_next/static/chunks/tag.js',
    'a root-absolute path must NOT be prefixed — the repair serves it, the prefix duplicates it');
  assert.equal(rewrite(`${L}/_next/static/chunks/tag.js`), `${L}/_next/static/chunks/tag.js`,
    'nor an absolute URL that is already on this origin');
  assert.equal(rewrite('/api/health'), '/api/health', 'nor a root-absolute API call');
  assert.equal(rewrite(`${L}/p/ENC/deep/asset.js`), `${L}/p/ENC/deep/asset.js`,
    'nor something already inside the tunnel');

  // Relative paths are `<base href>`'s job and must pass through untouched too.
  assert.equal(rewrite('assets/app.js'), 'assets/app.js');
  assert.equal(rewrite('data:text/plain,hi'), 'data:text/plain,hi');
});

test('the bridge still routes CROSS-origin URLs through the relay', async () => {
  // This is the branch that earns its keep: an absolute cross-origin asset
  // fetched from a loopback origin fails the target's CORS or hotlink check
  // (the referer names the proxy, not the site), so it has to be tunnelled.
  const html = await (await fetch(proxyUrl('/'))).text();
  const rewrite = loadMpRewrite(html);
  const L = 'http://127.0.0.1:19999';

  assert.equal(rewrite('https://cdn.other/x.js'), `${L}/p/${Buffer.from('https://cdn.other').toString('base64url')}/x.js`);
  assert.equal(rewrite('https://cdn.other/a/b.js?v=2'), `${L}/p/${Buffer.from('https://cdn.other').toString('base64url')}/a/b.js?v=2`);
});

// ── bot-check pages ─────────────────────────────────────────────────────────

test('a Cloudflare interstitial is explained instead of left as a dead end', async () => {
  // Measured on speedtest.net 2026-09-15. The check needs a `cf_clearance`
  // cookie the relay deliberately cannot keep, so it can never pass — the page
  // must say so rather than leaving the user on "Unable to connect".
  const { srv, port: p } = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head></head><body>'
      + 'Performing security verification<h1>Unable to connect to the website</h1>'
      + '</body></html>');
  });
  try {
    const html = await (await fetch(`${origin}/p/${proxy.encode(`http://127.0.0.1:${p}`)}/`)).text();
    assert.match(html, /Cloudflare/, 'the user must be told what this page is');
    assert.match(html, /cf_clearance/, 'and why the check cannot pass here');
    assert.doesNotMatch(html, /captcha widget cannot run/, 'the reCAPTCHA copy must not be used');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('an ordinary page gets no bot-check banner at all', async () => {
  const html = await (await fetch(proxyUrl('/'))).text();
  assert.doesNotMatch(html, /bot-check page served by the site itself/);
  assert.doesNotMatch(html, /Cloudflare's bot check/);
});
// ── one origin per site ─────────────────────────────────────────────────────
//
// The gap this closes was measured, not theorised: two unrelated sites both
// reported `origin=http://127.0.0.1:18780` and each could read a localStorage
// key the other had written. A browser never behaves that way, and no amount of
// header work fixes it — storage partitioning follows the ORIGIN, so the origin
// itself had to change. Chromium derives an origin from scheme+host+PORT, and
// 127.x.y.z aliases need root on macOS (`EADDRNOTAVAIL`), so the port it is.

test('the entry listener hands a site to its own loopback origin', async () => {
  const res = await fetch(`${origin}/go/${proxy.encode(targetOrigin)}/`, { redirect: 'manual' });
  assert.equal(res.status, 307, '307 so a POST entry keeps its method and body');
  const loc = res.headers.get('location');
  const site = new URL(loc);
  assert.equal(site.hostname, '127.0.0.1');
  assert.notEqual(site.port, String(port), 'a site must NOT be served from the shared entry port');
  // This response IS the answer to a frame navigation, so it needs the
  // embedding pair too — measured 2026-09-12: a redirect without them is
  // refused outright under the shell's `credentialless` COEP.
  assert.equal(res.headers.get('cross-origin-embedder-policy'), 'credentialless');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
});

test('two different sites are given two different origins', async () => {
  const a = await siteOriginFor(targetOrigin);
  const b = await siteOriginFor(elsewhere.base);
  assert.notEqual(a, b, 'two sites on one origin is exactly the bug being fixed');
});

test('the same site is handed the same origin every time it is asked', async () => {
  // Not cosmetic: a second port is a second origin, and a second origin has no
  // cookies and no localStorage — the user would be logged out at random.
  assert.equal(await siteOriginFor(targetOrigin), await siteOriginFor(targetOrigin));
});

test('the origin map is persisted, so a login survives a relay restart', async () => {
  const site = await siteOriginFor(targetOrigin);
  const saved = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  assert.equal(saved[targetOrigin], Number(new URL(site).port),
    'the port IS the origin, so it must outlive the process');
});

test('a site is served at its own ROOT, with no prefix and no <base>', async () => {
  const site = await siteOriginFor(targetOrigin);
  const html = await (await fetch(`${site}/`)).text();
  assert.match(html, /<title>Target<\/title>/);
  assert.doesNotMatch(html, /<base /,
    'a root-served document needs no <base> — the document URL is already right');
  assert.match(html, /href="\/next"/, 'root-absolute refs stay exactly as the target sent them');
});

test('a root-absolute path on a site listener is that site, not the info page', async () => {
  // This is what the un-prefixed repair used to be for. At the site's own root
  // there is nothing to repair: `/api.json` simply IS that site's path.
  const site = await siteOriginFor(targetOrigin);
  const res = await fetch(`${site}/api.json?q=1`);
  assert.deepEqual(await res.json(), { ok: true, echoed: '1' });
});

test('a cross-origin redirect moves the frame to THAT origin, not this one', async () => {
  const site = await siteOriginFor(targetOrigin);
  const res = await fetch(`${site}/xredir`, { redirect: 'manual' });
  assert.equal(res.status, 307);
  const loc = new URL(res.headers.get('location'));
  assert.notEqual(loc.origin, site, 'one site bytes must never wear another site origin');
  const landed = await fetch(`${loc.origin}/landed`);
  assert.match(await landed.text(), /landed elsewhere/);
});

test('the document tells the parent which site it really is', async () => {
  // The parent cannot invert a bare loopback origin — the port is the relay's
  // to choose — so without this the omnibox and the tab history stop tracking
  // the page the moment it navigates itself, which is every SPA.
  const site = await siteOriginFor(targetOrigin);
  const script = bridgeIn(await (await fetch(`${site}/`)).text());
  assert.ok(script.includes(`var __mpT=${JSON.stringify(targetOrigin)}`),
    'the bridge must carry the origin it is serving');
  assert.ok(script.includes('__mpP=""'), 'a root-served document has no prefix to cut');
  assert.match(script, /__mpProxy:'url',href:location\.href,target:realHref\(\)/);
  assert.match(script, /function realUrl\(u\)/, 'programmatic navigation must report the real url too');
});

test('a legacy /p/ document still carries its prefix, so the parent can invert it', async () => {
  const script = bridgeIn(await (await fetch(proxyUrl('/'))).text());
  assert.ok(script.includes(`__mpP="/p/${enc}"`), 'the prefix is what the parent slices off');
});

test("a cross-origin /p/ DOCUMENT is handed to the destination's own origin", async () => {
  // The injected script rewrites an absolute cross-origin URL to `/p/<enc>/`,
  // so an external link arrives at the CURRENT site's listener rather than
  // leaving the proxy. Serving it there is right for a subresource and wrong
  // for a document: measured in the app UI 2026-09-15, clicking example.com's
  // link to iana.org left the frame on the example.com origin, and iana.org's
  // own `localStorage.getItem` returned the key example.com had written.
  const site = await siteOriginFor(targetOrigin);
  const other = proxy.encode(new URL(elsewhere.base).origin);
  const res = await fetch(`${site}/p/${other}/landed`, {
    redirect: 'manual',
    headers: { 'sec-fetch-dest': 'document' },
  });
  assert.equal(res.status, 307, 'a cross-origin document must not be served in place');
  const loc = new URL(res.headers.get('location'));
  assert.notEqual(loc.origin, site, "the destination must get its OWN origin, not this site's");
  assert.equal(loc.hostname, '127.0.0.1');
  // This response IS the answer to a frame navigation, so it needs the pair.
  assert.equal(res.headers.get('cross-origin-embedder-policy'), 'credentialless');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const landed = await fetch(`${loc.origin}${loc.pathname}`);
  assert.match(await landed.text(), /landed elsewhere/);
});

test('a cross-origin /p/ SUBRESOURCE is still served in place, never redirected', async () => {
  // The rewrite exists precisely to keep these same-origin: under the shell's
  // COEP Chromium refuses a subresource that arrives behind a redirect, so
  // redirecting one would break the asset. That is the worse of the two
  // failures, which is why the discriminator has to be exact.
  const site = await siteOriginFor(targetOrigin);
  const other = proxy.encode(new URL(elsewhere.base).origin);
  const res = await fetch(`${site}/p/${other}/landed`, {
    redirect: 'manual',
    headers: { 'sec-fetch-dest': 'script' },
  });
  assert.equal(res.status, 200, 'a subresource must be served, not redirected');
  assert.match(await res.text(), /landed elsewhere/);
});

test('a request that cannot say what it is keeps the old in-place behaviour', async () => {
  // No `sec-fetch-dest` means a document cannot be told from an asset. Guessing
  // "document" risks refusing a subresource, so we do nothing instead.
  const site = await siteOriginFor(targetOrigin);
  const other = proxy.encode(new URL(elsewhere.base).origin);
  const res = await fetch(`${site}/p/${other}/landed`, { redirect: 'manual' });
  assert.equal(res.status, 200, 'an unattributable request must not be redirected on a guess');
});

test('the browser app addresses sites through /go/ and reads the reported url', () => {
  assert.match(browserApp, /\/go\/\$\{b64url\(u\.origin\)\}/,
    'relayProxyUrlFor must ask for a per-site origin');
  assert.match(browserApp, /data\.target/, 'the parent must prefer the relay-reported real url');
  assert.match(browserApp, /\(\?:p\|go\)/, 'relayProxyTargetFor must still invert both spellings');
});

// ── WebSocket tunnelling ────────────────────────────────────────────────────
//
// Also measured: an upgrade got a socket closed with NO response, so any site
// with a live channel — a chat, a dashboard, a terminal — was a dead end and
// its own reconnect loop spun forever.

test('an absolute WebSocket URL keeps its scheme, so TLS survives the hop', () => {
  const encoded = proxy.encode('wss://example.com');
  assert.equal(
    proxy.upgradeTarget({ url: `/__ws/${encoded}/chat?x=1`, headers: {} }, ''),
    'wss://example.com/chat?x=1'
  );
});

test('a relative WebSocket belongs to the site the listener serves', () => {
  assert.equal(
    proxy.upgradeTarget({ url: '/socket', headers: {} }, 'https://example.com'),
    'wss://example.com/socket'
  );
});

test('an upgrade with no attributable site is refused, not dialled blind', () => {
  assert.equal(proxy.upgradeTarget({ url: '/socket', headers: {} }, ''), '');
  assert.equal(proxy.upgradeTarget({ url: `/__ws/${proxy.encode('file:///etc')}/x`, headers: {} }, ''), '');
});

test('a WebSocket upgrade is tunnelled end to end, not refused', async () => {
  const site = await siteOriginFor(socketTarget.base);
  const { statusLine, body } = await rawUpgrade(site, '/socket');
  assert.match(statusLine, /101 Switching Protocols/,
    'the handshake must reach the target and its answer must come back');
  assert.equal(body, 'ping', 'bytes must flow both ways, not just the handshake');
});

test('a per-site listener sets no cookie of its own, so there is no cross-site channel', async () => {
  // Cookies are scoped to a HOST and know nothing about ports, while an origin
  // includes the port. So a cookie set on any per-site origin is sent by the
  // browser to EVERY per-site origin. Measured 2026-09-15: `mp_proxy_target`
  // arrived on a different site — a cross-site channel of exactly the kind the
  // per-site origins exist to close.
  const site = await siteOriginFor(targetOrigin);
  const res = await fetch(`${site}/`);
  assert.equal(res.headers.get('set-cookie'), null, 'a per-site listener must set no cookie');
});

test('the legacy /p/ path still sets the repair cookie it depends on', async () => {
  const res = await fetch(proxyUrl('/'));
  assert.match(String(res.headers.get('set-cookie')), /mp_proxy_target=/,
    'the un-prefixed repair reads this, and only that path needs it');
});
