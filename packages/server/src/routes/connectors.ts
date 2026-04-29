// ============================================================
// Connectors Config API
// ============================================================
// 返回 .thething/connectors/ 下的连接器配置列表
// 与 /api/connector/*（运行时操作）不同，本路由仅返回配置定义

import { Hono } from 'hono'
import { getServerContext } from '../runtime'

const app = new Hono()

/**
 * GET / — 获取所有连接器配置
 */
app.get('/', async (c) => {
  try {
    const context = await getServerContext()
    const connectors = context.connectors.map((conn) => ({
      id: conn.id,
      name: conn.name,
      version: conn.version,
      description: conn.description,
      enabled: conn.enabled,
      base_url: conn.base_url,
      auth: conn.auth,
      toolCount: conn.tools?.length ?? 0,
    }))

    return c.json({ connectors })
  } catch (error) {
    console.error('[Connectors API] Error:', error)
    return c.json({ error: 'Failed to load connectors' }, 500)
  }
})

export default app
