// ============================================================
// @the-thing/server — Hono HTTP API Entry
// ============================================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { serve } from '@hono/node-server'
import path from 'path'

// Routes
import chatRoutes from './routes/chat'
import conversationsRoutes from './routes/conversations'
import tasksRoutes from './routes/tasks'
import permissionsRoutes from './routes/permissions'
import mcpRoutes from './routes/mcp'
import skillsRoutes from './routes/skills'
import agentsRoutes from './routes/agents'
import connectorsRoutes from './routes/connectors'
import memoryRoutes from './routes/memory'
import debugRoutes from './routes/debug'
import connectorToolsRoutes from './routes/connector/tools'
import connectorTestRoutes from './routes/connector/test'
import connectorAdminToolsRoutes from './routes/connector/admin/tools'
import connectorAdminTestToolRoutes from './routes/connector/admin/test-tool'
import connectorAdminLogsRoutes from './routes/connector/admin/logs'
import connectorWebhooksRoutes from './routes/connector/webhooks'
import fsRoutes from './routes/fs'

// Runtime management
export {
  initServerRuntime,
  getServerRuntime,
  getServerContext,
  getServerDataStore,
  disposeServerRuntime,
  reloadServerContext,
} from './runtime'

const app = new Hono()

// CORS for local development
app.use('*', cors({
  origin: ['http://localhost:3000', 'http://localhost:3456'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Mount routes under /api prefix
app.route('/api/chat', chatRoutes)
app.route('/api/conversations', conversationsRoutes)
app.route('/api/tasks', tasksRoutes)
app.route('/api/permissions', permissionsRoutes)
app.route('/api/mcp', mcpRoutes)
app.route('/api/skills', skillsRoutes)
app.route('/api/agents', agentsRoutes)
app.route('/api/connectors', connectorsRoutes)
app.route('/api/memory', memoryRoutes)
app.route('/api/debug', debugRoutes)
app.route('/api/connector/tools', connectorToolsRoutes)
app.route('/api/connector/test', connectorTestRoutes)
app.route('/api/connector/admin/tools', connectorAdminToolsRoutes)
app.route('/api/connector/admin/test-tool', connectorAdminTestToolRoutes)
app.route('/api/connector/admin/logs', connectorAdminLogsRoutes)
app.route('/api/connector/webhooks', connectorWebhooksRoutes)
app.route('/api/fs', fsRoutes)

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }))

// ============================================================
// Static Assets Server Configuration
// ============================================================

let staticAssetsDir: string | null = null

/**
 * Configure static assets directory for SPA frontend
 * @param dir - Path to the static assets directory (e.g., packages/web/dist)
 */
export function configureStaticAssets(dir: string): void {
  staticAssetsDir = dir
}

/**
 * Get current static assets directory
 */
export function getStaticAssetsDir(): string | null {
  return staticAssetsDir
}

/**
 * Setup static assets serving middleware
 * This should be called after configuring the assets directory
 */
export function setupStaticAssets(): void {
  if (!staticAssetsDir) {
    console.log('[Static Assets] No static assets directory configured, skipping...')
    return
  }

  // Serve static assets from the configured directory
  app.use('/assets/*', serveStatic({
    root: staticAssetsDir,
    rewriteRequestPath: (p) => p.replace('/assets', 'assets'),
  }))

  // Serve index.html for root path
  app.get('/', serveStatic({
    root: staticAssetsDir,
    path: 'index.html',
  }))

  // SPA fallback: serve index.html for any non-API, non-health path
  // This handles client-side routing (React Router)
  app.get('*', async (c, next) => {
    const path = c.req.path
    // Skip API routes and health check
    if (path.startsWith('/api/') || path === '/health') {
      return next()
    }
    // Serve index.html for SPA routes
    return serveStatic({
      root: staticAssetsDir!,
      path: 'index.html',
    })(c, next)
  })

  console.log(`[Static Assets] Serving from: ${staticAssetsDir}`)
}

/**
 * Start the HTTP server on the specified port
 * @param port - Port number to listen on
 * @returns The server instance
 */
export function startServer(port: number): ReturnType<typeof serve> {
  return serve({
    fetch: app.fetch,
    port,
  })
}

// Export app for testing and CLI usage
export { app }

// Export Hono type for external usage
export type AppType = typeof app