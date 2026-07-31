import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  typescript: {
    ignoreBuildErrors: true,
  },
  // Turbopack 配置（Next.js 16 默认使用 Turbopack）
  turbopack: {},
  experimental: {
    // 关闭 Turbopack dev 持久化缓存（beta）：其 LSM 存储回收跟不上高频开发的
    // 追加写入，.next/dev/cache/turbopack 曾累积到 82GB 打满磁盘。
    // 代价是 dev server 冷启动全量编译。
    turbopackFileSystemCacheForDev: false,
  },
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
          '**/.thething/memory/**',
          '**/.workbuddy/memory/**',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
