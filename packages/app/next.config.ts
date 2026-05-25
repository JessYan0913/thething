import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
