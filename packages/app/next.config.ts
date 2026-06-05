import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', '@the-thing/core'],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
