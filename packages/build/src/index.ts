// ============================================================
// @the-thing/build - Portable Build Entry Point
// ============================================================

export { PLATFORMS, getCurrentPlatform, getPlatformConfig, isValidPlatform } from './platforms'
export type { PlatformConfig } from './platforms'

export { buildSea } from './sea-builder'
export { compileNativeModules } from './native-compiler'
export { assemblePortable } from './assembler'

/**
 * Build portable executable for a platform
 */
export async function buildPortable(platformKey: string): Promise<void> {
  const { buildSea } = await import('./sea-builder')
  const { compileNativeModules } = await import('./native-compiler')
  const { assemblePortable } = await import('./assembler')
  const { getPlatformConfig } = await import('./platforms')

  const platform = getPlatformConfig(platformKey)

  console.log(`[Build] Starting portable build for ${platformKey}`)

  // Step 1: Build SEA executable
  console.log('[Build] Step 1: Building SEA executable...')
  await buildSea(platform)

  // Step 2: Compile native modules for target platform
  console.log('[Build] Step 2: Compiling native modules...')
  await compileNativeModules(platform)

  // Step 3: Assemble portable directory
  console.log('[Build] Step 3: Assembling portable directory...')
  await assemblePortable(platform)

  console.log(`[Build] Portable build complete for ${platformKey}`)
}