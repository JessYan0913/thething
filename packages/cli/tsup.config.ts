import { defineConfig } from 'tsup'
import { writeFileSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  minify: false,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // 只 external 原生模块
  external: ['better-sqlite3'],
  // 打包所有其他依赖
  noExternal: [/.*/],
  dts: false,
  // 构建完成后生成发布用的 package.json
  async onSuccess() {
    const srcPkg = JSON.parse(
      readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
    )

    // 发布版本：只保留必要字段
    const distPkg = {
      name: srcPkg.name,
      version: srcPkg.version,
      // bin 相对于 dist 目录
      bin: {
        thething: './index.js',
      },
      description: srcPkg.description || '',
      license: srcPkg.license || 'MIT',
      // 只保留原生模块依赖（用户安装时编译）
      dependencies: {
        'better-sqlite3': srcPkg.dependencies['better-sqlite3'] || '^12.8.0',
      },
      engines: srcPkg.engines || { node: '>=20' },
      keywords: srcPkg.keywords || [],
      repository: srcPkg.repository,
      homepage: srcPkg.homepage,
      bugs: srcPkg.bugs,
      author: srcPkg.author,
    }

    writeFileSync(
      resolve(__dirname, 'dist/package.json'),
      JSON.stringify(distPkg, null, 2) + '\n'
    )

    console.log('✓ 已生成 dist/package.json（发布版本）')
  },
})