const nextConfig = {
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
          // NOTE: Content-Security-Policy is deliberately absent here.
          // src/proxy.js (middleware) sets it with a per-request nonce and a
          // nonce-less script-src. Emitting a second CSP here would be enforced
          // as an intersection and undo the nonce hardening.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          },
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
