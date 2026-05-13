// ============================================================
// Connector Admin Logs API
// ============================================================

import { Hono } from 'hono'

// 内存中的日志存储（生产环境应该用数据库或日志服务）
interface CallLog {
  id: string
  timestamp: string
  connectorId: string
  toolName: string
  success: boolean
  durationMs: number
  input: Record<string, unknown>
  result?: unknown
  error?: string
}

const callLogs: CallLog[] = []
const MAX_LOGS = 1000

const app = new Hono()

app.get('/', (c) => {
  const connectorId = c.req.query('connectorId')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')

  let filteredLogs = callLogs

  if (connectorId) {
    filteredLogs = callLogs.filter(log => log.connectorId === connectorId)
  }

  const total = filteredLogs.length
  const paginatedLogs = filteredLogs
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(offset, offset + limit)

  // 统计
  const stats = {
    totalCalls: callLogs.length,
    successRate: callLogs.length > 0
      ? (callLogs.filter(l => l.success).length / callLogs.length * 100).toFixed(2) + '%'
      : '0%',
    avgDurationMs: callLogs.length > 0
      ? Math.round(callLogs.reduce((sum, l) => sum + l.durationMs, 0) / callLogs.length)
      : 0,
    byConnector: {} as Record<string, { total: number; success: number; avgMs: number }>,
  }

  // 按 connector 统计
  for (const log of callLogs) {
    if (!stats.byConnector[log.connectorId]) {
      stats.byConnector[log.connectorId] = { total: 0, success: 0, avgMs: 0 }
    }
    const s = stats.byConnector[log.connectorId]
    s.total++
    if (log.success) s.success++
    s.avgMs += log.durationMs
  }

  for (const [id, s] of Object.entries(stats.byConnector)) {
    s.avgMs = Math.round(s.avgMs / (stats.byConnector[id]?.total || 1))
  }

  return c.json({
    success: true,
    data: {
      logs: paginatedLogs,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
      stats,
    },
  })
})

// 记录日志
app.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      connectorId: string
      toolName: string
      success: boolean
      durationMs: number
      input: Record<string, unknown>
      result?: unknown
      error?: string
    }>()

    const log: CallLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...body,
    }

    callLogs.unshift(log)

    // 限制日志数量
    if (callLogs.length > MAX_LOGS) {
      callLogs.splice(MAX_LOGS)
    }

    return c.json({ success: true, logId: log.id })
  } catch (error) {
    return c.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500
    )
  }
})

export default app
