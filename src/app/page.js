import PageClient from './page.client';

// Force dynamic rendering — REQUIRED for the nonce-based CSP.
//
// src/proxy.js (middleware) mints a per-request CSP nonce and sends the
// strict production policy `script-src 'self' 'nonce-...' 'wasm-unsafe-eval'`.
// If this page is statically prerendered at build time, the served HTML can
// never contain the nonce, so every inline bootstrap script
// (self.__next_f.push...) is blocked by the browser
// ("Either the 'unsafe-inline' keyword, a hash, or a nonce is required").
// Rendering on demand lets Next.js embed the request's nonce into all
// inline scripts.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <PageClient />;
}