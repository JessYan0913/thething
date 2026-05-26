import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    outputFileTracingIncludes: {
      '/**': ['./node_modules/styled-jsx/**', './node_modules/@swc/helpers/**'],
    },
  },
};

export default nextConfig;
