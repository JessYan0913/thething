import { defineConfig } from 'tsup'
import { writeFileSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// esbuild 插件：在解析阶段强制 external better-sqlite3
const externalizePlugin = {
  name: 'externalize-native-and-runtime',
  setup(build: any) {
    build.onResolve({ filter: /better-sqlite3/ }, (args: any) => {
      return { path: 'better-sqlite3', external: true }
    })
    const runtimeDeps = /^(react|react\/|ink|ink\/|ink-text-input|yoga-wasm-web|react-devtools-core)/
    build.onResolve({ filter: runtimeDeps }, (args: any) => {
      if (args.kind !== 'entry-point') {
        return { path: args.path, external: true }
      }
    })
  },
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  minify: false,
  sourcemap: true,
  shims: false,
  splitting: false,
  banner: {
    js: `#!/usr/bin/env node
import { createRequire as __banner_createRequire } from 'module';
import { fileURLToPath as __banner_fileURLToPath } from 'url';
import { dirname as __banner_dirname } from 'path';
const require = __banner_createRequire(import.meta.url);
const __filename = __banner_fileURLToPath(import.meta.url);
const __dirname = __banner_dirname(__filename);`,
  },
  // 打包所有其他依赖（包括 workspace 包）
  noExternal: [/.*/],
  // 使用 esbuild 插件强制 external 原生模块
  esbuildPlugins: [externalizePlugin],
  esbuildOptions(options) {
    options.jsx = 'automatic'
    options.jsxImportSource = 'react'
  },
  dts: false,
  // 构建完成后生成发布用的 package.json并复制 web 资源
  async onSuccess() {
    const srcPkg = JSON.parse(
      readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
    )

    // 发布版本：只保留必要字段
    const distPkg = {
      name: srcPkg.name,
      version: srcPkg.version,
      // bin 相对于 dist 目录
      type: 'module',
      bin: {
        thething: './index.mjs',
      },
      description: srcPkg.description || '',
      license: srcPkg.license || 'MIT',
      // 只保留原生模块依赖（用户安装时编译）
      dependencies: {
        'better-sqlite3': srcPkg.dependencies['better-sqlite3'] || '^12.8.0',
        'react': srcPkg.dependencies['react'] || '^18.3.1',
        'ink': srcPkg.dependencies['ink'] || '^4.4.1',
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