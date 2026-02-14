/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['ssh2'],
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
};

export default nextConfig;
