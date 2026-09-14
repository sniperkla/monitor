/**
 * Turn a failed HTTP response body into one line a human can read.
 *
 * The bug this exists to prevent: `AgentWebUIBrowserApp.probeTab()` treated the
 * body of ANY non-2xx as the message and rendered it verbatim in the
 * "Web UI Unreachable" card — a `max-w-md` box holding `text-xs`. But the WebUI
 * proxy answers its catch-all 500 with a deliberately HTML page
 * (`src/app/api/agents/webui-proxy/route.js`):
 *
 *     <html><body style="background:#111;color:#f87171;…">
 *       <h2>💥 Proxy Error</h2><pre>${message}</pre>
 *     </body></html>
 *
 * That is the RIGHT response for that route: the same URL is also an `<iframe>`
 * src, where a human navigating to it should get a rendered page. The mismatch is
 * on the consumer side — a programmatic probe is asking for a *message*, not a
 * document — so the fix belongs here, not in the route.
 *
 * Measured before the fix (captured in `scratch/explore-bookmark-local-withconn.png`):
 *
 *     Web UI Unreachable
 *     <html><body style="background:#111;color:#f87171;font-family:monospace…
 *
 * After: the same response reads `💥 Proxy Error Connection not found`.
 *
 * Note the ordering inside `summarizeHttpFailure`: entities are decoded AFTER
 * tags are stripped. Decoding first would let an escaped `&lt;` become a real
 * `<` and get mistaken for markup. Rendering is React text, so a decoded `<` is
 * inert either way.
 */

/** Longest summary we will hand to the UI. Matches the pre-existing slice(0, 300). */
export const ERROR_SUMMARY_MAX = 300;

/** Collapse all whitespace runs — HTML bodies arrive with newlines and indentation. */
function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Drop <script>/<style> bodies first, then every remaining tag. */
function stripTags(html) {
  return String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

/** Minimal entity decode — `&amp;` last, or `&amp;lt;` would become `<`. */
function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Pull the useful sentence out of a JSON error body.
 *
 * Tries the field names this app and its neighbours actually use, including
 * NextAuth's `errors[]` shape. Returns `''` when the body is not JSON or carries
 * no recognisable message, so the caller can fall through.
 */
function pickJsonMessage(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return '';
  }
  if (typeof parsed === 'string') return collapse(parsed);
  if (!parsed || typeof parsed !== 'object') return '';

  for (const key of ['error', 'message', 'detail', 'reason']) {
    const v = parsed[key];
    if (typeof v === 'string' && v.trim()) return collapse(v);
  }
  const errors = parsed.errors;
  if (Array.isArray(errors) && errors.length) {
    const first = errors[0];
    if (typeof first === 'string') return collapse(first);
    if (first && typeof first.message === 'string') return collapse(first.message);
  }
  return '';
}

/**
 * @param {object} failure
 * @param {number} [failure.status]       HTTP status, used only for the fallback copy
 * @param {string} [failure.contentType]  the response's content-type header
 * @param {string} [failure.body]         the response body, as text
 * @returns {string} a single line, never empty, never raw markup
 */
export function summarizeHttpFailure({ status = 0, contentType = '', body = '' } = {}) {
  const raw = String(body ?? '');
  const collapsed = collapse(raw);
  const fallback = `HTTP status ${status} from agent server.`;
  if (!collapsed) return fallback;

  const ct = String(contentType || '').toLowerCase();
  // Content-type first, then sniff — servers lie about content-type often enough
  // that trusting it alone would let a JSON body be rendered as markup.
  const looksJson = ct.includes('json') || /^[[{]/.test(collapsed);
  const looksHtml =
    ct.includes('html') || /^<(?:!doctype|html|body|head|h[1-6]|pre|div|p|span)\b/i.test(collapsed);

  let out = '';
  if (looksJson) {
    out = pickJsonMessage(raw) || pickJsonMessage(collapsed);
    // A JSON body we cannot read a message out of must NOT be printed as-is:
    // braces and escaped quotes filling a 300-char card is the same failure as
    // markup doing it. Better to say nothing useful than to say it unreadably.
    if (!out) return fallback;
  }
  if (!out && looksHtml) out = stripTags(raw);

  if (!out) out = raw;
  out = collapse(decodeEntities(out));
  if (!out) return fallback;

  return out.length > ERROR_SUMMARY_MAX
    ? `${out.slice(0, ERROR_SUMMARY_MAX - 1).trimEnd()}…`
    : out;
}
