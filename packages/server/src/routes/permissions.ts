// ============================================================
// Permissions API
// ============================================================

import { Hono } from 'hono'
import { removeRule, saveRule, loadRules, type PermissionBehavior } from '@the-thing/core'

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = await c.req.json<{ toolName: string; pattern?: string; behavior?: PermissionBehavior }>()
    const { toolName, pattern, behavior } = body

    if (!toolName) {
      return c.json({ error: 'Missing toolName' }, 400)
    }

    const rule = await saveRule({
      toolName,
      pattern,
      behavior: behavior || 'allow',
    })

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

    await removeRule(id)
    return c.json({ success: true })
  } catch (error) {
    console.error('[Permissions API] Error:', error)
    return c.json({ error: 'Failed to remove rule' }, 500)
  }
})

app.get('/', async (c) => {
  try {
    const config = await loadRules()
    return c.json({ rules: config.rules })
  } catch (error) {
    console.error('[Permissions API] Error:', error)
    return c.json({ error: 'Failed to load rules' }, 500)
  }
})

export default app