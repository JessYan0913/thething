// ============================================================
// Skills API
// ============================================================

import { Hono } from 'hono'
import { getServerContext } from '../runtime'

const app = new Hono()

/**
 * GET / — 获取所有技能列表
 *
 * 从 CoreRuntime 的 AppContext 中读取已加载的技能列表，
 * 确保路径解析统一经过 bootstrap() → createContext() 流程。
 */
app.get('/', async (c) => {
  try {
    const context = await getServerContext()
    const skills = context.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      allowedTools: skill.allowedTools,
      model: skill.model,
      effort: skill.effort,
      context: skill.context,
      paths: skill.paths,
      sourcePath: skill.sourcePath,
      source: skill.source ?? 'project',
    }))

    return c.json({ skills })
  } catch (error) {
    console.error('[Skills API] Error:', error)
    return c.json({ error: 'Failed to load skills' }, 500)
  }
})

export default app
