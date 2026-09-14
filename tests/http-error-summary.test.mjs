import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { summarizeHttpFailure, ERROR_SUMMARY_MAX } from '../src/utils/httpErrorSummary.js';

/**
 * The "Web UI Unreachable" card must show a sentence, not markup.
 *
 * The bug: `AgentWebUIBrowserApp.probeTab()` fed the raw body of any non-2xx
 * response straight into the card's copy —
 *
 *     detail = (await res.text()).slice(0, 300).replace(/\s+/g, ' ').trim()
 *
 * — and the WebUI proxy's catch-all 500 is an HTML page on purpose, because the
 * same URL doubles as an `<iframe>` src. So the user read this inside a
 * `max-w-md` box set in `text-xs`:
 *
 *     Web UI Unreachable
 *     <html><body style="background:#111;color:#f87171;font-family:monospace;
 *     padding:2rem"> <h2>💥 Proxy Error</h2><pre>Connection not found</pre>
 *
 * Captured in `scratch/explore-bookmark-local-withconn.png`.
 *
 * These tests exercise the real module rather than a source regex: the failure
 * was a wrong VALUE, and a regex can only prove a string is absent.
 */

const ROUTE = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');
const APP = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

/** The route's own error page, verbatim in shape. */
function routeErrorPage(message) {
  return `<html><body style="background:#111;color:#f87171;font-family:monospace;padding:2rem">
        <h2>💥 Proxy Error</h2><pre>${message.replace(/</g, '&lt;')}</pre>
      </body></html>`;
}

test('the premise still holds: the proxy 500 really is an HTML page', () => {
  // If this ever stops being true the tests below are guarding nothing, so
  // assert the route's shape rather than assuming it.
  assert.match(
    ROUTE,
    /status: 500, headers: \{ 'Content-Type': 'text\/html' \}/,
    'the proxy catch-all 500 is expected to answer text/html — re-check this suite if that changed'
  );
});

test('the real 500 body renders as a sentence, not markup', () => {
  const out = summarizeHttpFailure({
    status: 500,
    contentType: 'text/html',
    body: routeErrorPage('Connection not found'),
  });
  assert.ok(!out.includes('<'), `markup leaked into the card: ${out}`);
  assert.ok(!out.includes('&lt;'), `escaped markup leaked into the card: ${out}`);
  assert.match(out, /Proxy Error/);
  assert.match(out, /Connection not found/);
});

test('an error message containing angle brackets survives as text', () => {
  // The route escapes `<` so its own page cannot be broken by a message. The
  // summarizer must decode it back AFTER stripping tags — decode-first would
  // let the escaped bracket be eaten as if it were a tag.
  const out = summarizeHttpFailure({
    status: 500,
    contentType: 'text/html',
    body: routeErrorPage('unexpected token < at position 4'),
  });
  assert.match(out, /unexpected token < at position 4/);
});

test('&amp;lt; decodes to &lt;, not to a tag', () => {
  // `&amp;` must be substituted last, or a double-escaped bracket becomes real
  // markup and gets stripped as one.
  const out = summarizeHttpFailure({
    status: 500,
    contentType: 'text/html',
    body: '<html><body><pre>&amp;lt;notatag&amp;gt;</pre></body></html>',
  });
  assert.equal(out, '&lt;notatag&gt;');
});

test('script and style bodies are dropped, not flattened into the card', () => {
  const out = summarizeHttpFailure({
    status: 500,
    contentType: 'text/html',
    body: '<html><head><style>body{color:red}</style></head><body><script>var x=1;</script><p>Real reason here</p></body></html>',
  });
  assert.equal(out, 'Real reason here');
});

test('a JSON error body yields its message', () => {
  for (const key of ['error', 'message', 'detail', 'reason']) {
    const out = summarizeHttpFailure({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ [key]: 'Forbidden by policy' }),
    });
    assert.equal(out, 'Forbidden by policy');
  }
});

test('a JSON body with no message falls back rather than printing braces', () => {
  const out = summarizeHttpFailure({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, code: 'X' }),
  });
  // Nothing recognisable to say — but it must still be a sentence, and it must
  // not be raw JSON.
  assert.ok(!out.includes('{'), `raw JSON leaked into the card: ${out}`);
  assert.equal(out, 'HTTP status 500 from agent server.');
});

test('a JSON body sent as text/html is still parsed', () => {
  // Servers lie about content-type often enough that sniffing has to win.
  const out = summarizeHttpFailure({
    status: 500,
    contentType: 'text/html',
    body: '{"error":"Misconfigured tunnel"}',
  });
  assert.equal(out, 'Misconfigured tunnel');
});

test('an empty or unreadable body falls back to the status line', () => {
  assert.equal(summarizeHttpFailure({ status: 502, contentType: '', body: '' }), 'HTTP status 502 from agent server.');
  assert.equal(summarizeHttpFailure({ status: 502 }), 'HTTP status 502 from agent server.');
  assert.equal(summarizeHttpFailure({ status: 502, body: '   \n  ' }), 'HTTP status 502 from agent server.');
  assert.equal(summarizeHttpFailure(), 'HTTP status 0 from agent server.');
});

test('a long body is truncated to one bounded line', () => {
  const out = summarizeHttpFailure({
    status: 500,
    contentType: 'text/plain',
    body: 'x'.repeat(2000),
  });
  assert.ok(out.length <= ERROR_SUMMARY_MAX, `expected <= ${ERROR_SUMMARY_MAX} chars, got ${out.length}`);
  assert.ok(out.endsWith('…'), 'a truncated summary should say so');
});

test('whitespace in a plain-text body collapses to a single line', () => {
  const out = summarizeHttpFailure({
    status: 500,
    contentType: 'text/plain',
    body: '  line one\n\n\tline two  ',
  });
  assert.equal(out, 'line one line two');
});

test('probeTab routes the failure body through the summarizer', () => {
  // The helper being correct does not prove the card uses it. Pin the wiring,
  // and pin that the raw-body echo is gone — the two things that were wrong.
  assert.match(APP, /import \{ summarizeHttpFailure \} from '@\/utils\/httpErrorSummary'/);
  assert.match(APP, /error: summarizeHttpFailure\(\{/);

  const rawEcho = /\(await res\.text\(\)\)\.slice\(0,\s*300\)/;
  assert.ok(
    !rawEcho.test(APP),
    'probeTab must not slice the raw response body into the error card'
  );
});
