// ============================================================
// CLI Entry Point for Portable Build
// ============================================================

import { buildPortable, isValidPlatform, getCurrentPlatform } from './index'

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  // Parse platform argument
  let platformKey: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) {
      platformKey = args[i + 1]
      i++
    }
  }

  // Default to current platform if not specified
  if (!platformKey) {
    const current = getCurrentPlatform()
    platformKey = `${current.platform}-${current.arch}`
    console.log(`[CLI] No platform specified, using current: ${platformKey}`)
  }

  // Validate platform
  if (!isValidPlatform(platformKey)) {
    console.error(`Error: Invalid platform "${platformKey}"`)
    console.error(`Valid platforms: darwin-arm64, darwin-x64, win32-x64, linux-x64`)
    process.exit(1)
  }

  // Build portable
  try {
    await buildPortable(platformKey)
  } catch (error) {
    console.error('[CLI] Build failed:', error)
    process.exit(1)
  }
}

main()