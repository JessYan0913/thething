import * as esbuild from 'esbuild'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Plugin to resolve workspace dependencies
const workspacePlugin = {
  name: 'workspace-resolver',
  setup(build) {
    // Resolve @thething/* packages to their source
    build.onResolve({ filter: /^@thething\/(core|server)/ }, (args) => {
      const pkgName = args.path.replace('@thething/', '')
      const pkgJson = JSON.parse(
        readFileSync(resolve(__dirname, `../${pkgName}/package.json`), 'utf8')
      )
      const entryPoint = resolve(__dirname, `../${pkgName}`, pkgJson.main || 'src/index.ts')
      return { path: entryPoint, external: false }
    })
  }
}

const isWatch = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/index.js',
  format: 'cjs',
  banner: {
    js: '#!/usr/bin/env node',
  },
  // External native modules (can't be bundled)
  external: [
    'better-sqlite3',
  ],
  plugins: [workspacePlugin],
  sourcemap: true,
  minify: false,
  logLevel: 'error',
})

if (isWatch) {
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log('Build complete!')
}