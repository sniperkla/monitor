import Link from 'next/link';

// Force dynamic rendering so the per-request CSP nonce (src/proxy.js) is
// embedded in the HTML's inline bootstrap scripts. A statically prerendered
// 404 page would have its inline scripts blocked by the strict production
// CSP (`script-src 'self' 'nonce-...'`).
//
// NOTE: this renders INSIDE the root layout — it must NOT include its own
// <html>/<body> tags.
export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '4rem', margin: 0 }}>404</h1>
        <p style={{ opacity: 0.7 }}>This page could not be found.</p>
        <Link href="/" style={{ color: '#818cf8' }}>Back to home</Link>
      </div>
    </div>
  );
}