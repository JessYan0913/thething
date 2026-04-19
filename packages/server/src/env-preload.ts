// ============================================================
// Environment Preloader
// ============================================================
// This file MUST be imported BEFORE any other modules
// to ensure environment variables are loaded early

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// Load .env.local from monorepo root
const envPath = path.resolve(__dirname, '../../../.env.local')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
}