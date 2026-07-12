import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  typescript: {
    ignoreBuildErrors: true,
  },
  // Turbopack 配置（Next.js 16 默认使用 Turbopack）
  turbopack: {},
  // 排除 memory/wiki 目录的文件监听，避免 Fast Refresh 中断流式响应
  // 注意：此配置仅在使用 webpack 模式（--webpack 标志）时生效
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...(Array.isArray(config.watchOptions?.ignored) ? config.watchOptions.ignored : []),
          '**/node_modules/**',
          '**/.git/**',
          // 排除用户 memory 目录（wiki 写入不触发 Fast Refresh）
          path.join(process.env.HOME || '~', '.thething', 'memory', '**'),
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
