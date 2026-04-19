// ============================================================
// Environment Variables Loader
// ============================================================
// This file MUST be imported before any other modules
// to ensure environment variables are loaded before other modules initialize

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

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
    path.resolve(__dirname, '../../../.env.local'),
    path.resolve(__dirname, '../../../.env'),
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