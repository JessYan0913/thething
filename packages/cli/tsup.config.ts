import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  minify: false,
  sourcemap: true,
  // 自动添加 shebang
  banner: {
    js: '#!/usr/bin/env node',
  },
  // 原生模块必须 external
  external: ['better-sqlite3'],
  // workspace 依赖打包进 bundle（不 external）
  noExternal: [/^@thething\/(core|server)$/],
  // 不需要类型声明文件
  dts: false,
})