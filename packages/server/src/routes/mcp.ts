// ============================================================
// MCP Server Configuration API
// ============================================================

import { Hono } from 'hono'
import {
  getMcpServerConfigs,
  getMcpServerConfig,
  addMcpServerConfig,
  updateMcpServerConfig,
  deleteMcpServerConfig,
  createMcpRegistry,
  type McpServerConfig,
} from '@the-thing/core'
import { getServerRuntime } from '../runtime'

const app = new Hono()

/** 从 runtime 获取 resourceRoot */
async function getResourceRoot(): Promise<string> {
  const runtime = await getServerRuntime()
  return runtime.layout.resourceRoot
}

app.get('/', async (c) => {
  try {
    const name = c.req.query('name')
    const connect = c.req.query('connect') === 'true'
    const resourceRoot = await getResourceRoot()

    if (name) {
      const config = await getMcpServerConfig(name, resourceRoot)
      if (!config) {
        return c.json({ error: 'Server not found' }, 404)
      }

      if (connect) {
        const registry = createMcpRegistry([config])
        try {
          await registry.connectAll()
          const snapshot = registry.snapshot()
          await registry.disconnectAll()
          return c.json({ config, snapshot })
        } catch (error) {
          await registry.disconnectAll()
          return c.json({
            config,
            snapshot: {
              servers: [{ name: config.name, enabled: true, connected: false, toolCount: 0, error: String(error) }],
              totalTools: 0,
            },
          })
        }
      }

      return c.json({ config })
    }

    const configs = await getMcpServerConfigs(resourceRoot)
    return c.json({ servers: configs })
  } catch (error) {
    console.error('[MCP API] GET error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

app.post('/', async (c) => {
  try {
    const body = await c.req.json() as McpServerConfig

    if (!body.name || !body.transport?.type) {
      return c.json({ error: 'name and transport.type are required' }, 400)
    }

    const resourceRoot = await getResourceRoot()
    const existing = await getMcpServerConfig(body.name, resourceRoot)
    if (existing) {
      return c.json({ error: 'Server already exists' }, 409)
    }

    const config = await addMcpServerConfig(body, resourceRoot)
    return c.json({ config }, 201)
  } catch (error) {
    console.error('[MCP API] POST error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

app.put('/', async (c) => {
  try {
    const name = c.req.query('name')

    if (!name) {
      return c.json({ error: 'name query parameter is required' }, 400)
    }

    const body = await c.req.json() as Partial<McpServerConfig>
    const resourceRoot = await getResourceRoot()
    const config = await updateMcpServerConfig(name, body, resourceRoot)

    if (!config) {
      return c.json({ error: 'Server not found' }, 404)
    }

    return c.json({ config })
  } catch (error) {
    console.error('[MCP API] PUT error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

app.delete('/', async (c) => {
  try {
    const name = c.req.query('name')

    if (!name) {
      return c.json({ error: 'name query parameter is required' }, 400)
    }

    const resourceRoot = await getResourceRoot()
    const deleted = await deleteMcpServerConfig(name, resourceRoot)
    if (!deleted) {
      return c.json({ error: 'Server not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('[MCP API] DELETE error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default app