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
  webpack: (config, { isServer }) => {
    if (isServer) {
      const builtins = new Set([
        'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
        'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'fs/promises',
        'http', 'http2', 'https', 'module', 'net', 'os', 'path', 'process',
        'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
        'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm',
        'worker_threads', 'zlib',
      ]);
      config.externals = [
        ...(config.externals || []),
        ({ request }: { request: string }, callback: (err?: Error, result?: string) => void) => {
          if (request.startsWith('node:')) {
            return callback(undefined, `commonjs ${request.slice(5)}`);
          }
          if (builtins.has(request)) {
            return callback(undefined, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
};

export default nextConfig;
