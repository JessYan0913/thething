// ============================================================
// Environment Variables Loader
// ============================================================
// This file MUST be imported before any other modules
// to ensure environment variables are loaded before other modules initialize

// Suppress punycode deprecation warning (from dependencies)
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return
  }
  console.warn(warning)
})

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// Get directory path - use __dirname (available in bundled CJS output)
const currentDir = __dirname

// Try to load .env files from multiple locations
function loadEnvFiles(): void {
  // Prevent multiple loads
  if (process.env.__ENV_LOADED === 'true') {
    return
  }

  const envLocations = [
    // Current working directory
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    // Monorepo root (when running from packages/cli)
    // Go up from currentDir: src/lib -> src -> cli -> packages -> root
    path.resolve(currentDir, '../../../.env.local'),
    path.resolve(currentDir, '../../../.env'),
    // Alternative: go up 4 levels to account for tsx execution context
    path.resolve(currentDir, '../../../../.env.local'),
    path.resolve(currentDir, '../../../../.env'),
    // User home directory
    path.resolve(process.env.HOME || '', '.thething/.env.local'),
  ]

  for (const envPath of envLocations) {
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath, override: false })
      if (result.error) {
        console.warn(`[Env] Failed to load ${envPath}: ${result.error.message}`)
      } else {
        // Only log in debug mode
        if (process.env.DEBUG) {
          console.log(`[Env] Loaded from: ${envPath}`)
        }
      }
    }
  }

  // Mark as loaded
  process.env.__ENV_LOADED = 'true'
}

// Execute immediately
loadEnvFiles()