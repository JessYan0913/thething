// ============================================================
// Agents API
// ============================================================

import { Hono } from 'hono'
import { getServerContext } from '../runtime'

const app = new Hono()

/**
 * GET / — 获取所有代理定义列表
 */
app.get('/', async (c) => {
  try {
    const context = await getServerContext()
    const agents = context.agents.map((agent) => ({
      agentType: agent.agentType,
      description: agent.description,
      displayName: agent.displayName,
      tools: agent.tools,
      model: agent.model,
      effort: agent.effort,
      maxTurns: agent.maxTurns,
      permissionMode: agent.permissionMode,
      background: agent.background,
      memory: agent.memory,
      skills: agent.skills,
      source: agent.source,
      filePath: agent.filePath,
    }))

    return c.json({ agents })
  } catch (error) {
    console.error('[Agents API] Error:', error)
    return c.json({ error: 'Failed to load agents' }, 500)
  }
})

export default app
