// Cross-Origin-Embedder-Policy is the one header here that can plausibly break
// something: `credentialless` makes cross-origin no-cors subresources (avatars,
// CDN images) load without cookies. Nothing in this app needs that, but if a
// future embed does, set COEP=unsafe-none to drop just this header.
const COEP = process.env.COEP === 'unsafe-none' ? 'unsafe-none' : 'credentialless';

const nextConfig = {
  // Lets CI/security verification build into an isolated directory without
  // touching the active deployment's `.next` cache.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ['ssh2', 'pg', 'pg-native', 'pg-pool', 'mysql2', 'mongoose', 'mongodb'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Robots-Tag', value: 'noai, noimageai' },
          // Legacy XSS auditor. Ignored by modern browsers, kept for the ones
          // that still honour it. CSP is the real control.
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // NOTE: Content-Security-Policy is deliberately absent here.
          // src/proxy.js (middleware) sets it with a per-request nonce and a
          // nonce-less script-src. Emitting a second CSP here would be enforced
          // as an intersection and undo the nonce hardening.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()'
          },
          // ── Cross-origin isolation / resource containment ─────────────────
          // 'same-origin-allow-popups' rather than 'same-origin': the Google
          // Drive and rclone OAuth flows open a popup and receive the result
          // via window.opener.postMessage(). Plain 'same-origin' severs that
          // relationship and silently breaks both integrations, while
          // 'same-origin-allow-popups' still protects against the reverse
          // direction — a hostile page that opens us gets no opener handle.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          // 'credentialless' instead of 'require-corp' on purpose: require-corp
          // would block every cross-origin image that does not opt in via CORP
          // (Google avatars, Unsplash, GitHub avatars), breaking the UI.
          { key: 'Cross-Origin-Embedder-Policy', value: COEP },
          // Stops other origins from pulling our images/scripts/JSON into a
          // <img>/<script> tag as a side channel.
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          // Tells legacy Adobe/Acrobat clients there is no cross-domain policy.
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
        ],
      },
      {
        source: '/api/agents/webui-proxy',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        crypto: false,
      };
    }
    return config;
  },
  turbopack: {
    root: './'
  }
};

export default nextConfig;
