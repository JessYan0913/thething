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
  // 原生模块必须 external（无法打包）
  external: ['better-sqlite3'],
  // 打包所有其他依赖（正则匹配所有非原生模块）
  noExternal: [/.*/],
  // 不需要类型声明文件
  dts: false,
})