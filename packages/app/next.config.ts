import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 注入应用版本号，单一来源为 package.json，供客户端「关于」区块展示。
// 用 fs 绝对路径读取而非 import JSON：兼容 Next 16 的 Node 原生 TS 加载器
// （其对 JSON import 要求 with { type: 'json' } attribute）。
const appPkg = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'),
) as { version: string };

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@the-thing/core', 'better-sqlite3'],
  env: {
    NEXT_PUBLIC_APP_VERSION: appPkg.version,
  },
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
