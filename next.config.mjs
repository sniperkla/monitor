/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['ssh2', 'pg', 'pg-native'],
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
