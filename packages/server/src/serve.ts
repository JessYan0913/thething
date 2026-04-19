// ============================================================
// @thething/server — Server Startup
// ============================================================

// IMPORTANT: Import env-preload FIRST to load environment variables
// before any other modules that depend on them
import './env-preload'

import { serve } from '@hono/node-server'
import { app } from './index'

const PORT = parseInt(process.env.PORT || '3456', 10)

console.log(`[Server] Starting Hono server on port ${PORT}...`)
console.log(`[Server] DASHSCOPE_BASE_URL: ${process.env.DASHSCOPE_BASE_URL}`)

serve({
  fetch: app.fetch,
  port: PORT,
})

console.log(`[Server] Server running at http://localhost:${PORT}`)
console.log(`[Server] API endpoints available at http://localhost:${PORT}/api/*`)
console.log(`[Server] Health check at http://localhost:${PORT}/health`)