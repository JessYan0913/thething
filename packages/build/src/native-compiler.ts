// ============================================================
// Native Module Compiler
// ============================================================

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import type { PlatformConfig } from './platforms'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const BUILD_DIR = path.join(ROOT_DIR, 'dist', 'portable')

// Native modules that need cross-platform compilation
const NATIVE_MODULES = ['better-sqlite3']

/**
 * Compile native modules for target platform
 */
export async function compileNativeModules(platform: PlatformConfig): Promise<void> {
  const outputDir = path.join(BUILD_DIR, `${platform.platform}-${platform.arch}`)
  const nativeDir = path.join(outputDir, 'native')

  if (!fs.existsSync(nativeDir)) {
    fs.mkdirSync(nativeDir, { recursive: true })
  }

  console.log(`[Native] Compiling native modules for ${platform.platform}-${platform.arch}...`)

  // Check if we're building for current platform
  const isCurrentPlatform = process.platform === platform.platform && process.arch === platform.arch

  if (isCurrentPlatform) {
    // Copy entire better-sqlite3 package (including lib/ wrapper)
    copyBetterSqlite3Package(nativeDir)
  } else {
    // Cross-platform compilation requires special handling
    await compileCrossPlatform(platform, nativeDir)
  }
}

/**
 * Copy better-sqlite3 package with wrapper files
 * This is necessary because the npm package wraps the native addon
 * with a JavaScript layer that provides the correct constructor signature
 */
function copyBetterSqlite3Package(nativeDir: string): void {
  // Find the better-sqlite3 package in node_modules
  const pkgPath = findBetterSqlite3PackagePath()
  if (!pkgPath) {
    console.warn(`[Native] Warning: Could not find better-sqlite3 package`)
    return
  }

  // Create better-sqlite3 directory in native/
  const targetPkgDir = path.join(nativeDir, 'better-sqlite3')
  if (!fs.existsSync(targetPkgDir)) {
    fs.mkdirSync(targetPkgDir, { recursive: true })
  }

  // Copy native binding (.node file)
  const nativeBindingPath = path.join(pkgPath, 'build', 'Release', 'better_sqlite3.node')
  if (fs.existsSync(nativeBindingPath)) {
    const targetBuildDir = path.join(targetPkgDir, 'build', 'Release')
    if (!fs.existsSync(targetBuildDir)) {
      fs.mkdirSync(targetBuildDir, { recursive: true })
    }
    fs.copyFileSync(nativeBindingPath, path.join(targetBuildDir, 'better_sqlite3.node'))
    console.log(`[Native] Copied native binding from ${nativeBindingPath}`)
  }

  // Copy lib/ directory (wrapper files)
  const libPath = path.join(pkgPath, 'lib')
  if (fs.existsSync(libPath)) {
    const targetLibDir = path.join(targetPkgDir, 'lib')
    copyDirectory(libPath, targetLibDir)
    console.log(`[Native] Copied lib/ wrapper files`)
  }

  // Copy necessary dependencies
  const depsPath = path.join(pkgPath, 'deps')
  if (fs.existsSync(depsPath)) {
    copyDirectory(depsPath, path.join(targetPkgDir, 'deps'))
    console.log(`[Native] Copied deps/ directory`)
  }

  // Copy bindings helper (needed by lib/database.js)
  const bindingsPath = findBindingsPackagePath()
  if (bindingsPath) {
    const targetBindingsDir = path.join(targetPkgDir, 'node_modules', 'bindings')
    if (!fs.existsSync(targetBindingsDir)) {
      fs.mkdirSync(targetBindingsDir, { recursive: true })
    }
    // Copy bindings.js
    fs.copyFileSync(
      path.join(bindingsPath, 'bindings.js'),
      path.join(targetBindingsDir, 'bindings.js')
    )
    console.log(`[Native] Copied bindings helper`)
  }

  console.log(`[Native] better-sqlite3 package copied to ${targetPkgDir}`)
}

/**
 * Find better-sqlite3 package path in node_modules
 */
function findBetterSqlite3PackagePath(): string | null {
  const possiblePaths = [
    // pnpm structure
    path.join(ROOT_DIR, 'node_modules', '.pnpm', 'better-sqlite3@12.8.0', 'node_modules', 'better-sqlite3'),
    // Direct install
    path.join(ROOT_DIR, 'node_modules', 'better-sqlite3'),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'lib', 'index.js'))) {
      return p
    }
  }

  // Search using find
  try {
    const result = execSync(
      `find "${path.join(ROOT_DIR, 'node_modules')}" -type d -name "better-sqlite3" 2>/dev/null | head -1`,
      { encoding: 'utf-8' }
    ).trim()
    if (result && fs.existsSync(path.join(result, 'lib', 'index.js'))) {
      return result
    }
  } catch {
    // Ignore find errors
  }

  return null
}

/**
 * Find bindings package path (helper for native module loading)
 */
function findBindingsPackagePath(): string | null {
  const possiblePaths = [
    path.join(ROOT_DIR, 'node_modules', '.pnpm', 'bindings@1.5.0', 'node_modules', 'bindings'),
    path.join(ROOT_DIR, 'node_modules', 'bindings'),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'bindings.js'))) {
      return p
    }
  }

  return null
}

/**
 * Copy directory recursively
 */
function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Cross-platform compilation (experimental)
 */
async function compileCrossPlatform(platform: PlatformConfig, nativeDir: string): Promise<void> {
  console.warn(`[Native] Cross-platform compilation for ${platform.platform}-${platform.arch} is experimental`)
  console.warn(`[Native] Native modules will need to be compiled on the target platform or using Docker`)

  // For now, create placeholder structure
  const platformNativeDir = path.join(nativeDir, platform.nativeDirName)
  if (!fs.existsSync(platformNativeDir)) {
    fs.mkdirSync(platformNativeDir, { recursive: true })
  }

  // Create a placeholder file indicating the module needs to be compiled
  const placeholderPath = path.join(platformNativeDir, 'NEEDS_COMPILATION.txt')
  fs.writeFileSync(placeholderPath, `
Native modules for ${platform.platform}-${platform.arch} need to be compiled separately.

To compile:
1. On a ${platform.platform}-${platform.arch} machine:
   pnpm rebuild better-sqlite3

2. Copy the resulting .node file to this directory.

Alternative: Use Docker for cross-compilation:
   docker run --rm -v ${ROOT_DIR}:/app -w /app node:22 pnpm rebuild better-sqlite3
`)

  console.log(`[Native] Created placeholder at ${platformNativeDir}`)
}