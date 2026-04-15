// ============================================================
// Connector 调用日志 API
// GET /api/connector/admin/logs
// POST /api/connector/admin/logs
// ============================================================

import { NextRequest, NextResponse } from 'next/server'

// 内存中的日志存储（生产环境应该用数据库或日志服务）
interface CallLog {
  id: string
  timestamp: string
  connector_id: string
  tool_name: string
  success: boolean
  duration_ms: number
  input: Record<string, unknown>
  result?: unknown
  error?: string
}

const callLogs: CallLog[] = []
const MAX_LOGS = 1000

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const connectorId = searchParams.get('connector_id')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  let filteredLogs = callLogs

  if (connectorId) {
    filteredLogs = callLogs.filter(log => log.connector_id === connectorId)
  }

  const total = filteredLogs.length
  const paginatedLogs = filteredLogs
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(offset, offset + limit)

  // 统计
  const stats = {
    total_calls: callLogs.length,
    success_rate: callLogs.length > 0
      ? (callLogs.filter(l => l.success).length / callLogs.length * 100).toFixed(2) + '%'
      : '0%',
    avg_duration_ms: callLogs.length > 0
      ? Math.round(callLogs.reduce((sum, l) => sum + l.duration_ms, 0) / callLogs.length)
      : 0,
    by_connector: {} as Record<string, { total: number; success: number; avg_ms: number }>,
  }

  // 按 connector 统计
  for (const log of callLogs) {
    if (!stats.by_connector[log.connector_id]) {
      stats.by_connector[log.connector_id] = { total: 0, success: 0, avg_ms: 0 }
    }
    const s = stats.by_connector[log.connector_id]
    s.total++
    if (log.success) s.success++
  }

  for (const [id, s] of Object.entries(stats.by_connector)) {
    s.avg_ms = Math.round(s.avg_ms / (stats.by_connector[id]?.total || 1))
  }

  return NextResponse.json({
    success: true,
    data: {
      logs: paginatedLogs,
      pagination: { total, limit, offset, has_more: offset + limit < total },
      stats,
    },
  })
}

// 记录日志
export async function POST(req: NextRequest) {
  try {
    const body: {
      connector_id: string
      tool_name: string
      success: boolean
      duration_ms: number
      input: Record<string, unknown>
      result?: unknown
      error?: string
    } = await req.json()

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

    return NextResponse.json({ success: true, log_id: log.id })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
