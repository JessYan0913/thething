// ============================================================
// Agents API
// ============================================================

import { Hono } from 'hono'
import { getServerContext, getServerRuntime, reloadServerContext } from '../runtime'
import { serializeAgentMarkdown, type AgentDefinition } from '@the-thing/core'
import { promises as fs } from 'fs'
import path from 'path'

const app = new Hono()

async function getPrimaryAgentsDir(): Promise<string> {
  const runtime = await getServerRuntime()
  const dirs = runtime.layout.resources.agents
  return dirs[dirs.length - 1]
}

async function ensureAgentsDir(): Promise<string> {
  const dir = await getPrimaryAgentsDir()
  try {
    await fs.access(dir)
  } catch {
    await fs.mkdir(dir, { recursive: true })
  }
  return dir
}

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

/**
 * GET /:agentType — 获取单个代理完整信息（含 instructions）
 */
app.get('/:agentType', async (c) => {
  try {
    const agentType = c.req.param('agentType')
    const context = await getServerContext()
    const agent = context.agents.find((a) => a.agentType === agentType)

    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    return c.json({
      agentType: agent.agentType,
      description: agent.description,
      displayName: agent.displayName,
      tools: agent.tools ?? [],
      disallowedTools: agent.disallowedTools ?? [],
      model: agent.model ?? 'inherit',
      effort: agent.effort,
      maxTurns: agent.maxTurns ?? 20,
      permissionMode: agent.permissionMode ?? null,
      background: agent.background ?? false,
      isolation: agent.isolation ?? null,
      memory: agent.memory ?? null,
      skills: agent.skills ?? [],
      includeParentContext: agent.includeParentContext ?? false,
      maxParentMessages: agent.maxParentMessages ?? null,
      summarizeOutput: agent.summarizeOutput ?? true,
      initialPrompt: agent.initialPrompt ?? '',
      instructions: agent.instructions ?? '',
      source: agent.source,
      filePath: agent.filePath,
      metadata: agent.metadata ?? {},
    })
  } catch (error) {
    console.error('[Agents API] GET detail error:', error)
    return c.json({ error: 'Failed to load agent' }, 500)
  }
})

/**
 * POST / — 创建新代理
 */
app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { agentType } = body

    if (!agentType || !body.description) {
      return c.json({ error: 'Missing required fields: agentType, description' }, 400)
    }

    const agentsDir = await ensureAgentsDir()
    const filePath = path.join(agentsDir, `${agentType}.md`)

    try {
      await fs.access(filePath)
      return c.json({ error: 'Agent already exists' }, 409)
    } catch {
      // File doesn't exist, proceed
    }

    const def: AgentDefinition = {
      agentType: body.agentType,
      displayName: body.displayName || '',
      description: body.description,
      tools: body.tools ?? [],
      disallowedTools: body.disallowedTools ?? [],
      model: body.model ?? 'inherit',
      effort: body.effort,
      maxTurns: body.maxTurns ?? 20,
      permissionMode: body.permissionMode ?? undefined,
      background: body.background ?? false,
      isolation: body.isolation ?? undefined,
      memory: body.memory ?? undefined,
      skills: body.skills ?? [],
      includeParentContext: body.includeParentContext ?? false,
      maxParentMessages: body.maxParentMessages ?? undefined,
      summarizeOutput: body.summarizeOutput ?? true,
      initialPrompt: body.initialPrompt ?? '',
      instructions: body.instructions ?? '',
      source: 'project',
      metadata: body.metadata ?? {},
    }

    const content = serializeAgentMarkdown(def)
    await fs.writeFile(filePath, content, 'utf-8')
    await reloadServerContext()

    return c.json({ success: true, filePath })
  } catch (error) {
    console.error('[Agents API] POST error:', error)
    return c.json({ error: 'Failed to create agent' }, 500)
  }
})

/**
 * PUT /:agentType — 更新代理
 */
app.put('/:agentType', async (c) => {
  try {
    const agentType = c.req.param('agentType')
    const body = await c.req.json()

    const agentsDir = await getPrimaryAgentsDir()
    const filePath = path.join(agentsDir, `${agentType}.md`)

    try {
      await fs.access(filePath)
    } catch {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const def: AgentDefinition = {
      agentType: body.agentType ?? agentType,
      displayName: body.displayName || '',
      description: body.description,
      tools: body.tools ?? [],
      disallowedTools: body.disallowedTools ?? [],
      model: body.model ?? 'inherit',
      effort: body.effort,
      maxTurns: body.maxTurns ?? 20,
      permissionMode: body.permissionMode ?? undefined,
      background: body.background ?? false,
      isolation: body.isolation ?? undefined,
      memory: body.memory ?? undefined,
      skills: body.skills ?? [],
      includeParentContext: body.includeParentContext ?? false,
      maxParentMessages: body.maxParentMessages ?? undefined,
      summarizeOutput: body.summarizeOutput ?? true,
      initialPrompt: body.initialPrompt ?? '',
      instructions: body.instructions ?? '',
      source: 'project',
      metadata: body.metadata ?? {},
    }

    // 如果 agentType 改变，需要删除旧文件
    if (body.agentType && body.agentType !== agentType) {
      await fs.unlink(filePath)
      const newPath = path.join(agentsDir, `${body.agentType}.md`)
      await fs.writeFile(newPath, serializeAgentMarkdown(def), 'utf-8')
    } else {
      await fs.writeFile(filePath, serializeAgentMarkdown(def), 'utf-8')
    }

    await reloadServerContext()
    return c.json({ success: true })
  } catch (error) {
    console.error('[Agents API] PUT error:', error)
    return c.json({ error: 'Failed to update agent' }, 500)
  }
})

/**
 * DELETE /:agentType — 删除代理
 */
app.delete('/:agentType', async (c) => {
  try {
    const agentType = c.req.param('agentType')
    const agentsDir = await getPrimaryAgentsDir()
    const filePath = path.join(agentsDir, `${agentType}.md`)

    try {
      await fs.access(filePath)
    } catch {
      return c.json({ error: 'Agent not found' }, 404)
    }

    await fs.unlink(filePath)
    await reloadServerContext()
    return c.json({ success: true })
  } catch (error) {
    console.error('[Agents API] DELETE error:', error)
    return c.json({ error: 'Failed to delete agent' }, 500)
  }
})

/**
 * GET /:agentType/content — 获取代理 .md 原始内容
 */
app.get('/:agentType/content', async (c) => {
  try {
    const agentType = c.req.param('agentType')
    const agentsDir = await getPrimaryAgentsDir()
    const filePath = path.join(agentsDir, `${agentType}.md`)

    try {
      await fs.access(filePath)
    } catch {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const content = await fs.readFile(filePath, 'utf-8')
    return c.json({ content })
  } catch (error) {
    console.error('[Agents API] GET content error:', error)
    return c.json({ error: 'Failed to read agent content' }, 500)
  }
})

/**
 * PUT /:agentType/content — 直接写入代理 .md 内容
 */
app.put('/:agentType/content', async (c) => {
  try {
    const agentType = c.req.param('agentType')
    const body = await c.req.json() as { content: string }

    if (!body.content) {
      return c.json({ error: 'Missing content' }, 400)
    }

    const agentsDir = await getPrimaryAgentsDir()
    const filePath = path.join(agentsDir, `${agentType}.md`)

    try {
      await fs.access(filePath)
    } catch {
      return c.json({ error: 'Agent not found' }, 404)
    }

    await fs.writeFile(filePath, body.content, 'utf-8')
    await reloadServerContext()
    return c.json({ success: true })
  } catch (error) {
    console.error('[Agents API] PUT content error:', error)
    return c.json({ error: 'Failed to write agent content' }, 500)
  }
})

/**
 * POST /from-content — 从原始 .md 内容创建新代理
 */
app.post('/from-content', async (c) => {
  try {
    const body = await c.req.json() as { agentType: string; content: string }

    if (!body.agentType || !body.content) {
      return c.json({ error: 'Missing agentType or content' }, 400)
    }

    const agentsDir = await ensureAgentsDir()
    const filePath = path.join(agentsDir, `${body.agentType}.md`)

    try {
      await fs.access(filePath)
      return c.json({ error: 'Agent already exists' }, 409)
    } catch {
      // File doesn't exist, proceed
    }

    await fs.writeFile(filePath, body.content, 'utf-8')
    await reloadServerContext()
    return c.json({ success: true, filePath })
  } catch (error) {
    console.error('[Agents API] POST from-content error:', error)
    return c.json({ error: 'Failed to create agent' }, 500)
  }
})

export default app
