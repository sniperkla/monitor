import { NextResponse } from 'next/server';
import { assertSafeHttpUrl } from '@/lib/ssrfGuard';

export const dynamic = 'force-dynamic';

/**
 * /api/browser/proxy
 *
 * Lightweight web browsing proxy for the in-app desktop browser.
 * Fetches target web pages, strips anti-framing headers (X-Frame-Options, CSP frame-ancestors),
 * injects <base href="..."> for asset resolution, and protects against SSRF.
 */
export async function GET(request) {
  let targetUrl = '';
  try {
    const { searchParams } = new URL(request.url);
    targetUrl = searchParams.get('url');

    if (!targetUrl) {
      return new NextResponse('Missing url parameter', { status: 400 });
    }

    // SSRF Guard to prevent querying private/local networks
    await assertSafeHttpUrl(targetUrl);

    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return new NextResponse('Invalid protocol', { status: 400 });
    }

    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const contentType = res.headers.get('content-type') || 'text/html; charset=utf-8';

    // If it's HTML, inject <base href="..."> and strip framing headers
    if (contentType.includes('text/html')) {
      let html = await res.text();

      // Ensure relative links and resources resolve to the target origin
      const baseTag = `<base href="${targetUrl}">`;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, `$&${baseTag}`);
      } else {
        html = `${baseTag}${html}`;
      }

      const headers = new Headers();
      headers.set('Content-Type', contentType);
      headers.set('X-Frame-Options', 'SAMEORIGIN'); // allows embedding inside monitor

      return new NextResponse(html, {
        status: res.status,
        headers,
      });
    }

    // Non-HTML (images, stylesheets, json, etc.)
    const body = await res.arrayBuffer();
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    return new NextResponse(body, {
      status: res.status,
      headers,
    });
  } catch (err) {
    const isSsrf = err?.message?.includes('private') || err?.message?.includes('blocked');
    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Page Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
    h2 { font-size: 18px; margin: 0 0 8px 0; color: #f87171; }
    p { font-size: 13px; color: #a1a1aa; line-height: 1.5; margin: 0 0 20px 0; }
    .btn { display: inline-flex; align-items: center; gap: 8px; background: #0284c7; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 18px; border-radius: 10px; transition: background 0.2s; }
    .btn:hover { background: #0369a1; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${isSsrf ? 'Address Blocked by Security Policy' : 'Unable to Load In-App'}</h2>
    <p>${err?.message || 'The destination server refused the connection or is not responding.'}</p>
    ${targetUrl ? `<a href="${targetUrl}" target="_blank" class="btn">Open in External Browser Tab ↗</a>` : ''}
  </div>
</body>
</html>`,
      {
        status: 502,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'SAMEORIGIN' },
      }
    );
  }
}
