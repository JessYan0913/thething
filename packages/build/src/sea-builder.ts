// ============================================================
// SEA (Single Executable Application) Builder
// ============================================================

import * as esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import type { PlatformConfig } from './platforms'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const BUILD_DIR = path.join(ROOT_DIR, 'dist', 'portable')
const CLI_ENTRY = path.join(ROOT_DIR, 'packages', 'cli', 'src', 'index.ts')

/**
 * Build SEA executable for a platform
 */
export async function buildSea(platform: PlatformConfig): Promise<void> {
  const outputDir = path.join(BUILD_DIR, `${platform.platform}-${platform.arch}`)
  const bundleFile = path.join(outputDir, 'cli.bundle.js')
  const blobFile = path.join(outputDir, 'sea.blob')
  const executableFile = path.join(outputDir, platform.outputName)

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Step 1: Bundle CLI with esbuild
  console.log(`[SEA] Bundling CLI entry point...`)
  await bundleCli(bundleFile)

  // Step 2: Generate SEA config
  console.log(`[SEA] Generating SEA config...`)
  const seaConfigPath = path.join(outputDir, 'sea-config.json')
  generateSeaConfig(seaConfigPath, bundleFile, blobFile)

  // Step 3: Create SEA blob
  console.log(`[SEA] Creating SEA blob...`)
  createSeaBlob(seaConfigPath)

  // Step 4: Copy Node executable and inject blob
  console.log(`[SEA] Injecting blob into executable...`)
  await injectBlob(blobFile, executableFile, platform)

  console.log(`[SEA] Executable created: ${executableFile}`)
}

/**
 * Bundle CLI entry point with esbuild
 */
async function bundleCli(outputFile: string): Promise<void> {
  await esbuild.build({
    entryPoints: [CLI_ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: outputFile,
    minify: false,
    sourcemap: false,
    external: [
      // Native modules must be external (loaded dynamically)
      'better-sqlite3',
      // Large dependencies that should stay external
      'fsevents',
    ],
    define: {
      // Define process.env variables needed
      'process.env.NODE_ENV': '"production"',
    },
  })
}

/**
 * Generate SEA configuration file
 */
function generateSeaConfig(configPath: string, mainFile: string, outputFile: string): void {
  const config = {
    main: mainFile,
    output: outputFile,
    useCodeCache: true,
    useSnapshot: false,
    // Assets will be loaded externally for better-sqlite3
    assets: {},
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

/**
 * Create SEA blob using Node.js experimental SEA support
 */
function createSeaBlob(configPath: string): void {
  try {
    execSync(`node --experimental-sea-config "${configPath}"`, {
      cwd: path.dirname(configPath),
      stdio: 'inherit',
    })
  } catch (error) {
    throw new Error(`Failed to create SEA blob: ${error}`)
  }
}

/**
 * Inject SEA blob into Node executable using postject
 */
async function injectBlob(blobFile: string, executableFile: string, platform: PlatformConfig): Promise<void> {
  // Copy Node executable first
  const nodePath = process.execPath
  fs.copyFileSync(nodePath, executableFile)

  // Remove signature on macOS before injection
  if (platform.platform === 'darwin') {
    try {
      execSync(`codesign --remove-signature "${executableFile}"`, { stdio: 'inherit' })
    } catch {
      // Ignore if no signature exists
    }
  }

  // Inject blob using postject
  // The sentinel fuse for Node.js SEA is documented at:
  // https://nodejs.org/api/single-executable-applications.html
  const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
  const postjectArgs = [
    `"${executableFile}"`,
    'NODE_SEA_BLOB',
    `"${blobFile}"`,
    '--sentinel-fuse',
    sentinelFuse,
    '--macho-segment-name',
    'NODE_SEA',
  ]

  try {
    // Use npx to run postject
    execSync(`npx postject ${postjectArgs.join(' ')}`, {
      cwd: path.dirname(executableFile),
      stdio: 'inherit',
    })
  } catch (error) {
    throw new Error(`Failed to inject blob: ${error}`)
  }

  // Re-sign on macOS
  if (platform.platform === 'darwin') {
    try {
      execSync(`codesign --sign - "${executableFile}"`, { stdio: 'inherit' })
    } catch {
      console.warn('[SEA] Warning: Could not re-sign executable')
    }
  }
}