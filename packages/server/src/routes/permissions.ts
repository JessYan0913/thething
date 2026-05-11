// ============================================================
// Permissions API
// ============================================================

import { Hono } from 'hono'
import { removeRule, saveRule, loadRules, updateRule, type PermissionBehavior } from '@the-thing/core'
import { getServerRuntime } from '../runtime'

const app = new Hono()

/** 从 runtime 获取 resourceRoot */
async function getResourceRoot(): Promise<string> {
  const runtime = await getServerRuntime()
  return runtime.layout.resourceRoot
}

app.post('/', async (c) => {
  try {
    const body = await c.req.json<{ toolName: string; pattern?: string; behavior?: PermissionBehavior }>()
    const { toolName, pattern, behavior } = body

    if (!toolName) {
      return c.json({ error: 'Missing toolName' }, 400)
    }

    const resourceRoot = await getResourceRoot()
    const rule = await saveRule({
      toolName,
      pattern,
      behavior: behavior || 'allow',
    }, resourceRoot)

    return c.json({ success: true, rule })
  } catch (error) {
    console.error('[Permissions API] Error:', error)
    return c.json({ error: 'Failed to save rule' }, 500)
  }
})

app.delete('/', async (c) => {
  try {
    const id = c.req.query('id')

    if (!id) {
      return c.json({ error: 'Missing id' }, 400)
    }

    const resourceRoot = await getResourceRoot()
    await removeRule(id, resourceRoot)
    return c.json({ success: true })
  } catch (error) {
    console.error('[Permissions API] Error:', error)
    return c.json({ error: 'Failed to remove rule' }, 500)
  }
})

app.put('/', async (c) => {
  try {
    const id = c.req.query('id')

    if (!id) {
      return c.json({ error: 'Missing id' }, 400)
    }

    const body = await c.req.json<{ toolName?: string; pattern?: string; behavior?: PermissionBehavior }>()
    const { toolName, pattern, behavior } = body

    const resourceRoot = await getResourceRoot()
    const rule = await updateRule(id, {
      toolName,
      pattern,
      behavior,
    }, resourceRoot)

    if (!rule) {
      return c.json({ error: 'Rule not found' }, 404)
    }

    return c.json({ success: true, rule })
  } catch (error) {
    console.error('[Permissions API] Error:', error)
    return c.json({ error: 'Failed to update rule' }, 500)
  }
})

app.get('/', async (c) => {
  try {
    const resourceRoot = await getResourceRoot()
    const config = await loadRules(resourceRoot)
    return c.json({ rules: config.rules })
  } catch (error) {
    console.error('[Permissions API] Error:', error)
    return c.json({ error: 'Failed to load rules' }, 500)
  }
})

export default app